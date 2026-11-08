import { protectCurlyBraces } from "../utils.js";
import {
  applyConditionalToElement,
  compileExpr,
  evaluateConstant,
  extractCtxFromEl,
  extractPropsDefaults,
  getMountIf,
  hasMountIf,
  interpolateNode,
  reservedAttrs,
  scopeCss,
  validateChainStructure,
} from "../parser/index.js";
import {
  deterministicHash,
  runtimeFunctionId,
  throwError,
  warnConstantCondition,
} from "./utils.js";
import { parseFragment } from "./dom-processor.js";
import {
  applyTopLevelContext,
  resolveModuleForTag,
} from "./component-context.js";
import {
  findElementLocation,
  warnUnusedDeclarations,
} from "./component-warnings.js";
import { tagDescendants } from "./component-utils.js";
import {
  buildRuntimeSource,
  runtimeReach,
  serializeRuntimeContext,
} from "./component-runtime.js";

/**
 * Render one module instance.
 *
 * @param {import("./module-graph.js").ChocolaModule} module
 * @param {Element|null} usageElement null for the root component
 * @param {import("./component-context.js").ProcessContext} cx
 * @param {string[]} renderChain module ids already being rendered
 * @param {string|null} sourceFile owner module id, for errors
 * @param {string|null} sourceContent owner template, for errors
 * @param {object} globalCtx
 * @returns {DocumentFragment|Element|false}
 */
export function renderInstance(
  module,
  usageElement,
  cx,
  renderChain = [],
  sourceFile = null,
  sourceContent = null,
  globalCtx = {}
) {
  if (!module) return false;
  if (renderChain.includes(module.id)) return false;

  const doc = cx.doc;

  // Script-only components render nothing: remove a usage element, or return
  // an empty fragment at the root.
  if (!module.template) {
    if (usageElement) {
      usageElement.remove();
      return false;
    }
    return doc.createDocumentFragment();
  }

  const chain = renderChain.concat(module.id);
  const cssId = module.cssId || deterministicHash(module.id, 8);
  cx.cssScopesMap.set(module.id, cssId);

  let ctx;
  if (usageElement && cx.staticCtxRegistry.has(usageElement)) {
    ctx = cx.staticCtxRegistry.get(usageElement);
  } else {
    ctx = usageElement ? extractCtxFromEl(usageElement, globalCtx) : {};
    if (globalCtx && typeof globalCtx === "object") {
      for (const [key, value] of Object.entries(globalCtx)) {
        if (!(key in ctx)) ctx[key] = value;
      }
    }
    if (usageElement) cx.staticCtxRegistry.set(usageElement, ctx);
  }

  const compProps =
    module.compProps && module.compProps.length > 0
      ? module.compProps
      : extractPropsDefaults(module.script);

  for (const { name, defaultValue } of compProps) {
    if (defaultValue !== undefined && !(name in ctx)) {
      try {
        ctx[name] = compileExpr(defaultValue, false)();
      } catch {
        ctx[name] = defaultValue;
      }
    }
  }

  applyTopLevelContext(module, ctx);

  const ctxProxy = new Proxy(ctx, {
    has() {
      return true;
    },
    get(target, key) {
      return target[key];
    },
  });

  const protectedTemplate = protectCurlyBraces(module.template);
  const fragment = parseFragment(protectedTemplate, doc);
  tagDescendants(fragment, cssId);

  warnUnusedDeclarations(cx, module, fragment);

  const projectedHtml = usageElement ? usageElement.innerHTML : "";
  const slotFragment = usageElement
    ? parseFragment(projectedHtml, doc)
    : doc.createDocumentFragment();

  if (usageElement && sourceFile) {
    validateChainStructure(slotFragment, sourceFile, sourceContent, projectedHtml);
  }
  validateChainStructure(fragment, module.id, module.source, module.template);

  for (const slot of [...fragment.querySelectorAll("slot")]) {
    slot.replaceWith(...slotFragment.childNodes);
  }

  const childEntries = Array.from(fragment.querySelectorAll("*")).map((el) => ({
    el,
    parent: el.parentNode,
  }));
  const condChains = new Map();
  const bindings = [];
  const elBindIds = new Map();
  let bindCounter = 0;

  const conditionalLocations = new Map();
  for (const { el } of childEntries) {
    if (!el.hasAttribute("if") && !hasMountIf(el) && !el.hasAttribute("elif")) {
      continue;
    }
    conditionalLocations.set(el, findElementLocation(module, el));
  }

  childEntries.forEach(({ el: child, parent }) => {
    if (!fragment.contains(child)) return;
    if (!condChains.has(parent)) {
      condChains.set(parent, { active: false, rendered: false });
    }
    const condChain = condChains.get(parent);

    const hasIf = child.hasAttribute("if");
    const hasDelIf = hasMountIf(child);
    const hasElif = child.hasAttribute("elif");
    const hasElse = child.hasAttribute("else");

    if (hasIf || hasDelIf || hasElif) {
      const location = conditionalLocations.get(child) || module.id;
      const stripBraces = (raw) => (raw.startsWith("{") ? raw.slice(1, -1) : raw);
      const tag = child.tagName.toLowerCase();
      const warnIfConstant = (expr, attr) => {
        const { constant, value } = evaluateConstant(expr);
        if (constant) warnConstantCondition(location, tag, attr, expr, Boolean(value));
      };
      if (hasIf) warnIfConstant(stripBraces(child.getAttribute("if")), "if");
      if (hasDelIf) warnIfConstant(stripBraces(getMountIf(child)), "mount:if");
      if (hasElif) warnIfConstant(stripBraces(child.getAttribute("elif")), "elif");
    }

    if (hasElif || hasElse) {
      if (!condChain.active) {
        throwError(
          `${module.id}: <${child.tagName.toLowerCase()}> has ${
            hasElif ? "elif" : "else"
          } without a preceding if/mount:if sibling`
        );
      }
      if (condChain.rendered) {
        child.remove();
        if (hasElse) condChain.active = false;
        return;
      }
    }

    if (child.tagName.toLowerCase() === "void") {
      if (hasElif || hasElse) {
        if (hasElif) {
          const expr = child.getAttribute("elif").slice(1, -1);
          if (!compileExpr(expr, true)(ctxProxy)) {
            child.remove();
            return;
          }
        }
        child.replaceWith(...child.children);
        condChain.rendered = true;
        if (hasElse) condChain.active = false;
      } else if (hasIf || hasDelIf) {
        const raw = hasIf ? child.getAttribute("if") : getMountIf(child);
        const expr = raw.slice(1, -1);
        condChain.active = true;
        if (compileExpr(expr, true)(ctxProxy)) {
          child.replaceWith(...child.children);
          condChain.rendered = true;
        } else {
          child.remove();
          condChain.rendered = false;
        }
      } else {
        child.replaceWith(...child.children);
        condChain.active = false;
        condChain.rendered = false;
      }
      return;
    }

    for (const attribute of [...child.attributes]) {
      if (!attribute) continue;
      if (reservedAttrs.includes(attribute.name)) continue;

      if (attribute.name.startsWith("bind:")) {
        const prop = attribute.name.slice(5);
        const varName = attribute.value;
        let bindId = elBindIds.get(child);
        if (!bindId) {
          bindId = "b" + bindCounter++;
          elBindIds.set(child, bindId);
          child.setAttribute("data-chbind-" + bindId, "");
        }
        bindings.push({ prop, varName, bindId });
        child.removeAttribute(attribute.name);
        continue;
      }

      child.setAttribute(
        attribute.name,
        attribute.value.replace(/\{([^}]+)\}/g, (_, expr) => {
          try {
            return compileExpr(expr, true)(ctxProxy);
          } catch {
            return "";
          }
        })
      );
    }

    const childTag = child.tagName.toLowerCase();
    const childModule = resolveModuleForTag(module, childTag, cx.graph);
    const isComponentNode = Boolean(childModule);

    // Apply the conditional to a child component before rendering it. A false
    // mount:if/elif removes the element, and rendering first would emit an
    // orphaned runtime binding for a component that never reaches the output.
    if (isComponentNode) {
      applyConditionalToElement(
        child,
        ctxProxy,
        condChain,
        hasIf,
        hasDelIf,
        hasElif,
        hasElse
      );
      if (!child.parentNode) return;
    }

    let processed = false;
    if (isComponentNode) {
      processed = renderInstance(
        childModule,
        child,
        cx,
        chain,
        module.id,
        module.template,
        globalCtx
      );
      if (!child.parentNode) return;
    }

    let condTarget = child;
    if (processed && processed.nodeType === 1) {
      condTarget = processed;
    }

    if (!isComponentNode) {
      applyConditionalToElement(
        condTarget,
        ctxProxy,
        condChain,
        hasIf,
        hasDelIf,
        hasElif,
        hasElse
      );
    }

    interpolateNode(condTarget, ctxProxy);
  });

  if (!cx.moduleBindings.has(module.id)) {
    cx.moduleBindings.set(module.id, bindings);
  }

  const firstChild = fragment.firstElementChild;
  const runtimeInfo = runtimeReach(
    module,
    cx,
    bindings.map((binding) => binding.varName)
  );

  if (runtimeInfo && firstChild) {
    const existingChid = firstChild.getAttribute("chid");
    const compId =
      existingChid ||
      "chid-" + deterministicHash(module.id + ":" + cx.compIdColl.length, 8);

    if (!existingChid) {
      cx.compIdColl.push(compId);
      firstChild.setAttribute("chid", compId);
    }

    if (!cx.runtimeMap.has(module.id)) {
      const parts = buildRuntimeSource(module, cx, bindings, "server");
      if (parts) {
        cx.runtimeFunctions.set(module.id, parts.namedSource);
        cx.runtimeChunks.push(parts.namedSource);
        cx.runtimeMap.set(module.id, {
          fnId: module.fnId || runtimeFunctionId(module.id),
          chunkName: null,
        });
      }
    }

    cx.runtimeCalls.push({
      moduleId: module.id,
      fnId: module.fnId || runtimeFunctionId(module.id),
      chid: compId,
      ctxJson: serializeRuntimeContext(ctx),
    });
  }

  if (fragment.children.length === 1 && firstChild) {
    firstChild.classList.add(cssId);
  }

  if (
    usageElement &&
    usageElement.style &&
    usageElement.style.display === "none" &&
    firstChild
  ) {
    firstChild.style.display = "none";
  }

  if (module.styles && !cx.styleModules.has(module.id)) {
    cx.styleModules.add(module.id);
    cx.scopedStyles.push(scopeCss(module.styles, cssId));
  }

  if (usageElement) {
    usageElement.replaceWith(fragment);
    return firstChild || true;
  }

  return fragment;
}

/**
 * Thin wrapper around `renderInstance` used by the template walker.
 */
export function processComponentElement(
  element,
  cx,
  renderChain = [],
  ownerModule = cx.graph.root,
  globalCtx = {}
) {
  const childModule = resolveModuleForTag(
    ownerModule,
    element.tagName.toLowerCase(),
    cx.graph
  );
  if (!childModule) return false;

  return renderInstance(
    childModule,
    element,
    cx,
    renderChain,
    ownerModule.id,
    ownerModule.template,
    globalCtx
  );
}
