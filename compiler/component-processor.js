import path from "path";
import { protectCurlyBraces, restoreCurlyBraces } from "../utils.js";
import {
  extractPropsDefaults,
  extractRuntime,
  extractTopLevelFunctions,
  extractTopLevelVariables,
  parseScript,
  computeReachable,
  extractCtxFromEl,
  hasMountIf,
  getMountIf,
  reservedAttrs,
  validateChainStructure,
  applyConditionalToElement,
  interpolateNode,
  scopeCss,
  scopeAttribute,
  compileExpr,
  evaluateConstant,
} from "../parser/index.js";
import {
  deterministicHash,
  runtimeFunctionId,
  throwError,
  warnConstantCondition,
  warnUnusedDeclaration,
  findElementLine,
} from "./utils.js";
import { parseFragment } from "./dom-processor.js";
import { scanTemplateTags } from "./module-source.js";

const RUNTIME_KW = "$runtime";
const CHJS_EXTENSION = ".chjs";

function isChjsSource(source) {
  return typeof source === "string" && source.toLowerCase().endsWith(CHJS_EXTENSION);
}

/**
 * Fresh, per-render state. `render()` creates one of these per call so
 * concurrent renders never share mutable state.
 */
export class ProcessContext {
  constructor(graph, doc) {
    this.graph = graph;
    this.doc = doc;
    this.runtimeChunks = [];
    this.compIdColl = [];
    this.runtimeMap = new Map();
    this.cssScopesMap = new Map();
    this.scopedStyles = [];
    this.styleModules = new Set();
    this.staticCtxRegistry = new Map();
    this.csrClasses = new Map();
    this.classNames = new Map();
    this.usedImports = new Map();
    this.treeShakeRuntime = graph?.config?.treeShakeRuntime !== false;

    // Internal render bookkeeping.
    this.unusedWarned = new Set();
    this.csrGenerating = new Set();
    this.runtimeFunctions = new Map();
    this.runtimeCalls = [];
    this.moduleBindings = new Map();
  }

  resolveModuleForTag(ownerModule, tagLower) {
    return resolveModuleForTag(ownerModule, tagLower, this.graph);
  }
}

/**
 * Resolve a template tag in the scope of the module that owns the template.
 *
 * @param {import("./module-graph.js").ChocolaModule} ownerModule
 * @param {string} tagLower
 * @param {import("./module-graph.js").ModuleGraph} graph
 * @returns {import("./module-graph.js").ChocolaModule|null}
 */
export function resolveModuleForTag(ownerModule, tagLower, graph) {
  if (!ownerModule || !graph) return null;

  if (ownerModule.importMap.has(tagLower)) {
    return graph.moduleById(ownerModule.importMap.get(tagLower)) || null;
  }

  if (tagLower.includes(":")) {
    const [prefix, ...rest] = tagLower.split(":");
    const namespace = ownerModule.namespaceMap.get(prefix);
    if (namespace) {
      return graph.moduleById(namespace.components.get(rest.join("/"))) || null;
    }
  }

  return null;
}

/**
 * Canonical client class name: PascalCase basename + id hash.
 *
 * @param {import("./module-graph.js").ChocolaModule} module
 * @returns {string}
 */
export function canonicalClassName(module) {
  const basename = module.id.split("/").pop().replace(/\.chjs$/i, "");
  const words = basename.split(/[^A-Za-z0-9]+/).filter(Boolean);
  let name = words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
  if (!name) name = "Component";
  if (/^[0-9]/.test(name)) name = "_" + name;
  return `${name}_${deterministicHash(module.id, 4)}`;
}

function escapeForTemplateLiteral(str) {
  return str.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\${/g, "\\${");
}

function tagDescendants(node, cssId) {
  if (!cssId) return;
  const attr = scopeAttribute(cssId);
  for (const el of node.querySelectorAll("*")) {
    el.setAttribute(attr, "");
  }
}

function scopeTemplateHtml(html, cssId, doc) {
  const holder = doc.createElement("div");
  holder.innerHTML = html;
  tagDescendants(holder, cssId);
  return holder.innerHTML;
}

function findImportLocal(module, childId, tagLower) {
  for (const imp of module.imports || []) {
    if (!isChjsSource(imp.source)) continue;
    for (const specifier of imp.specifiers || []) {
      if (!specifier.local) continue;
      if (specifier.local.toLowerCase() !== tagLower) continue;
      if (module.importMap.get(tagLower) !== childId) continue;
      return specifier.local;
    }
  }
  return null;
}

function collectBindingNames(fragment) {
  const names = new Set();
  for (const el of fragment.querySelectorAll("*")) {
    for (const attr of el.attributes) {
      if (attr.name.startsWith("bind:")) names.add(attr.value);
    }
  }
  return [...names];
}

function findLineInSource(source, regex) {
  const match = regex.exec(source);
  if (!match) return null;
  return source.substring(0, match.index).split("\n").length;
}

function findElementLocation(module, element) {
  const outerHTML = restoreCurlyBraces(element.outerHTML);
  const lineNum = findElementLine(module.source, outerHTML);
  return lineNum !== null ? `${module.id}:${lineNum}` : module.id;
}

function warnUnusedDeclarations(cx, module, fragment) {
  if (cx.unusedWarned.has(module.id)) return;
  if (!module.script && !fragment.querySelector("[bind\\:]")) return;
  cx.unusedWarned.add(module.id);

  const script = module.script || "";
  const props = extractPropsDefaults(script).map((prop) => prop.name);
  const topVars = extractTopLevelVariables(script).map((variable) => variable.name);
  const topFuncs = extractTopLevelFunctions(script, RUNTIME_KW)
    .map(
      (src) =>
        src.match(/^(?:async\s+)?function\s+([a-zA-Z_$][0-9a-zA-Z_$]*)/)?.[1]
    )
    .filter(Boolean);

  const bindings = [];
  for (const el of fragment.querySelectorAll("*")) {
    for (const attr of el.attributes) {
      if (attr.name.startsWith("bind:")) {
        bindings.push({ name: attr.value, element: el });
      }
    }
  }

  const counts = new Map();
  const countIdentifiers = (text) => {
    for (const re of [
      /(?<![.\w$])[a-zA-Z_$][0-9a-zA-Z_$]*/g,
      /\.([a-zA-Z_$][0-9a-zA-Z_$]*)/g,
    ]) {
      re.lastIndex = 0;
      for (const match of text.matchAll(re)) {
        const name = match[1] ?? match[0];
        counts.set(name, (counts.get(name) || 0) + 1);
      }
    }
  };

  if (script) countIdentifiers(script);

  const walk = (node) => {
    if (node.nodeType === 3) {
      for (const match of node.textContent.matchAll(/\{([^}]+)\}/g)) {
        countIdentifiers(match[1]);
      }
      return;
    }
    if (node.attributes) {
      for (const attr of node.attributes) {
        if (attr.name.startsWith("bind:")) {
          countIdentifiers(attr.value);
        } else {
          for (const match of attr.value.matchAll(/\{([^}]+)\}/g)) {
            countIdentifiers(match[1]);
          }
        }
      }
    }
    for (const child of node.childNodes) walk(child);
  };
  walk(fragment);

  const isUnused = (name) => (counts.get(name) || 0) <= 1;
  const warn = (kind, name, declRegex) => {
    const lineNum = findLineInSource(module.source, declRegex);
    warnUnusedDeclaration(
      lineNum !== null ? `${module.id}:${lineNum}` : module.id,
      kind,
      name
    );
  };

  const escape = (name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  for (const name of props) {
    if (isUnused(name)) {
      warn("prop", name, new RegExp("export\\s+let\\s+" + escape(name) + "\\b"));
    }
  }
  for (const name of topVars) {
    if (isUnused(name)) {
      warn(
        "variable",
        name,
        new RegExp("(?:^|[^\\w])(?:let|const|var)\\s+" + escape(name) + "\\b")
      );
    }
  }
  for (const name of topFuncs) {
    if (isUnused(name)) {
      warn(
        "function",
        name,
        new RegExp("(?:async\\s+)?function\\s+" + escape(name) + "\\b")
      );
    }
  }
  const seenBindings = new Set();
  for (const { name, element } of bindings) {
    if (seenBindings.has(name)) continue;
    seenBindings.add(name);
    if (isUnused(name)) {
      const lineNum = findElementLine(module.source, element.outerHTML);
      warnUnusedDeclaration(
        lineNum !== null ? `${module.id}:${lineNum}` : module.id,
        "binding",
        name
      );
    }
  }
}

/**
 * Copy top-level script declarations into the server render context so
 * templates can interpolate them.
 */
function applyTopLevelContext(module, ctx) {
  const script = module.script;
  if (!script) return;

  const parsed = parseScript(script);
  const proxy = new Proxy(ctx, {
    has() {
      return true;
    },
    get(target, key) {
      return target[key];
    },
  });

  if (parsed.ast) {
    for (const variable of parsed.topVars) {
      if (variable.isDestructuring) {
        if (variable.names.every((name) => name in ctx)) continue;
        if (variable.value === undefined) {
          for (const name of variable.names) {
            if (!(name in ctx)) ctx[name] = undefined;
          }
          continue;
        }
        try {
          const initValue = compileExpr(variable.value, true)(proxy);
          const fnBody = `${variable.keyword} ${variable.name} = initVal; return {${variable.names.join(", ")}};`;
          const result = new Function("initVal", fnBody)(initValue);
          for (const name of variable.names) {
            if (!(name in ctx)) ctx[name] = result[name];
          }
        } catch {
          // Leave unresolved values out of the context.
        }
      } else {
        const { name, value } = variable;
        if (name in ctx) continue;
        if (value !== undefined) {
          try {
            ctx[name] = compileExpr(value, true)(proxy);
          } catch {
            // Leave unresolved values out of the context.
          }
        } else if (!(name in ctx)) {
          ctx[name] = undefined;
        }
      }
    }

    for (const src of parsed.topFuncs) {
      try {
        const fn = (0, eval)("(" + src + ")");
        const name = fn.name;
        if (name && !(name in ctx)) ctx[name] = fn;
      } catch {
        // Ignore declarations that cannot be evaluated on the server.
      }
    }
    return;
  }

  // Acorn fallback: use the conservative regex-derived declarations.
  for (const { name, value } of extractTopLevelVariables(script)) {
    if (name in ctx) continue;
    if (value !== undefined) {
      try {
        ctx[name] = compileExpr(value, true)(proxy);
      } catch {
        // Leave unresolved values out of the context.
      }
    }
  }
  for (const src of extractTopLevelFunctions(script, RUNTIME_KW)) {
    try {
      const fn = (0, eval)("(" + src + ")");
      const name = fn.name;
      if (name && !(name in ctx)) ctx[name] = fn;
    } catch {
      // Ignore declarations that cannot be evaluated on the server.
    }
  }
}

function runtimeReach(module, cx, bindingNames) {
  if (!module.script) return null;
  const parsed = parseScript(module.script);
  const runtime = parsed.runtime || extractRuntime(module.script, module.id);
  if (!runtime) return null;

  let reach = null;
  if (cx.treeShakeRuntime !== false && parsed.ast) {
    reach = computeReachable(parsed, { bindings: bindingNames });
    if (reach.fallback) reach = null;
  }

  return { parsed, runtime, reach };
}

function extractInlineRuntimeContext(script) {
  const match = script?.match(/ctx\s*=\s*({.*?})/);
  if (!match) return {};
  try {
    return JSON.parse(match[1].replace(/(\w+):/g, '"$1":'));
  } catch {
    return {};
  }
}

/**
 * Build a runtime function body for either the server hydration chunk
 * (`mode: "server"`) or a CSR class (`mode: "csr"`).
 *
 * Server hydration resolves `bind:` targets through their rendered
 * `data-chbind-*` attributes. CSR classes receive those values from the
 * `ChocolaComponent` binding collector through `ctx`.
 *
 * @returns {{ namedSource: string, csrSource: string }|null}
 */
function buildRuntimeSource(module, cx, bindings, mode) {
  const bindingNames = bindings.map((binding) =>
    typeof binding === "string" ? binding : binding.varName
  );
  const info = runtimeReach(module, cx, bindingNames);
  if (!info) return null;

  const { runtime, reach } = info;
  const script = module.script || "";
  const compProps =
    module.compProps && module.compProps.length > 0
      ? module.compProps
      : extractPropsDefaults(script);
  const topVars = extractTopLevelVariables(script);
  const topFuncs = extractTopLevelFunctions(script, RUNTIME_KW);

  let injectProps = compProps;
  let injectVars = topVars;
  let injectFuncs = topFuncs;
  let injectBindings = bindings;
  let csrBindingNames = bindingNames;

  if (reach) {
    const neededPropNames = new Set(reach.neededProps.map((prop) => prop.name));
    const neededVarNames = new Set(
      reach.neededVars.flatMap((variable) => variable.names)
    );
    const neededBindingNames = new Set(reach.neededBindings);
    const neededFuncNames = new Set(
      reach.neededFuncs
        .map(
          (src) =>
            src.match(
              /^(?:async\s+)?function\s+([a-zA-Z_$][0-9a-zA-Z_$]*)/
            )?.[1]
        )
        .filter(Boolean)
    );

    injectProps = compProps.filter((prop) => neededPropNames.has(prop.name));
    injectVars = topVars.filter((variable) =>
      neededVarNames.has(variable.name)
    );
    injectFuncs = topFuncs.filter((src) => {
      const name = src.match(
        /^(?:async\s+)?function\s+([a-zA-Z_$][0-9a-zA-Z_$]*)/
      )?.[1];
      return name && neededFuncNames.has(name);
    });
    injectBindings = bindings.filter((binding) =>
      typeof binding === "string"
        ? neededBindingNames.has(binding)
        : neededBindingNames.has(binding.varName)
    );
    csrBindingNames = bindingNames.filter((name) =>
      neededBindingNames.has(name)
    );
  }

  const runtimeCtx = extractInlineRuntimeContext(script);
  const declared = new Set(Object.keys(runtimeCtx));
  let inject = "";

  for (const [key, value] of Object.entries(runtimeCtx)) {
    inject += `let ${key} = ctx.${key}??${JSON.stringify(value)};\n`;
  }

  for (const { name, defaultValue } of injectProps) {
    if (declared.has(name)) continue;
    inject +=
      defaultValue !== undefined
        ? `let ${name} = ctx.${name}??(${defaultValue});\n`
        : `let ${name} = ctx.${name};\n`;
    declared.add(name);
  }

  for (const name of bindingNames) declared.add(name);

  for (const { keyword, name, value } of injectVars) {
    if (declared.has(name)) continue;
    inject +=
      value !== undefined
        ? `${keyword} ${name} = ${value};\n`
        : `${keyword} ${name};\n`;
    declared.add(name);
  }

  if (mode === "csr") {
    for (const name of csrBindingNames) {
      if (name === "self") continue;
      inject += `let ${name} = ctx.${name};\n`;
    }
  } else {
    for (const binding of injectBindings) {
      if (typeof binding === "string") continue;
      if (binding.varName === "self") continue;
      const accessor = binding.prop === "self" ? "" : "." + binding.prop;
      inject += `let ${binding.varName} = self.querySelector('[data-chbind-${binding.bindId}]')${accessor};\n`;
    }
  }

  if (injectFuncs.length > 0) {
    inject += "\n" + injectFuncs.join("\n\n") + "\n";
  }

  const injected = runtime.replace(
    /\$runtime\([^)]*\)\s*\{/,
    (match) => match + "\n" + inject
  );
  const namedSource = injected.replace(
    /\$runtime\([^)]*\)/,
    `${module.fnId}(self, ctx)`
  );
  const csrSource = namedSource.replace(
    /^(async\s+)?function\s+\w+/,
    "$1function"
  );

  return { namedSource, csrSource };
}

/**
 * Generate a CSR class for every module with a template.
 */
export function generateAllCSRClasses(graph, cx) {
  for (const id of [...graph.modules.keys()].sort()) {
    const module = graph.moduleById(id);
    if (module.template) generateCSRClass(module, cx);
  }
}

/**
 * Generate a `ChocolaComponent` subclass for one module.
 *
 * @param {import("./module-graph.js").ChocolaModule} module
 * @param {ProcessContext} cx
 */
export function generateCSRClass(module, cx) {
  if (!module || !module.template) return;

  const canonical = canonicalClassName(module);
  cx.classNames.set(module.id, canonical);

  const key = `${module.id}#${canonical}`;
  if (cx.csrClasses.has(key) || cx.csrGenerating.has(module.id)) return;
  cx.csrGenerating.add(module.id);

  const doc = cx.doc;
  const cssId = cx.cssScopesMap.get(module.id) || module.cssId;
  cx.cssScopesMap.set(module.id, cssId);

  const protectedTemplate = protectCurlyBraces(module.template);
  const template = scopeTemplateHtml(protectedTemplate, cssId, doc);
  const templateFragment = parseFragment(protectedTemplate, doc);

  const childMappings = [];
  const seenTags = new Set();
  for (const el of templateFragment.querySelectorAll("*")) {
    const tag = el.tagName.toLowerCase();
    if (seenTags.has(tag)) continue;
    seenTags.add(tag);

    const child = resolveModuleForTag(module, tag, cx.graph);
    if (!child || !child.template) continue;

    generateCSRClass(child, cx);
    childMappings.push({
      tag,
      compClass: findImportLocal(module, child.id, tag) || canonicalClassName(child),
    });
  }

  if (!cx.usedImports.has(module.id)) {
    const namespaceLocals = new Set(module.namespaceMap.keys());
    cx.usedImports.set(
      module.id,
      (module.imports || [])
        .filter((imp) => !isChjsSource(imp.source))
        .filter(
          (imp) =>
            !(imp.specifiers || []).some(
              (specifier) =>
                specifier.type === "namespace" &&
                specifier.local &&
                namespaceLocals.has(specifier.local.toLowerCase())
            )
        )
        .map((imp) => imp.raw)
    );
  }

  if (module.styles && !cx.styleModules.has(module.id)) {
    cx.styleModules.add(module.id);
    cx.scopedStyles.push(scopeCss(module.styles, cssId));
  }

  const bindingNames = collectBindingNames(templateFragment);
  const runtimeParts = buildRuntimeSource(module, cx, bindingNames, "csr");

  if (
    runtimeParts &&
    !cx.runtimeFunctions.has(module.id) &&
    cx.moduleBindings.has(module.id)
  ) {
    const serverParts = buildRuntimeSource(
      module,
      cx,
      cx.moduleBindings.get(module.id),
      "server"
    );
    if (serverParts) cx.runtimeFunctions.set(module.id, serverParts.namedSource);
  }

  const propsPart =
    module.compProps && module.compProps.length > 0
      ? `{ ${module.compProps
          .map(
            ({ name, defaultValue }) =>
              `${JSON.stringify(name)}: ${
                defaultValue !== undefined ? defaultValue : "null"
              }`
          )
          .join(", ")} }`
      : "{}";
  const runtimePart = runtimeParts
    ? `,\n      runtime: ${runtimeParts.csrSource}`
    : "";
  const childrenPart =
    childMappings.length > 0
      ? ",\n      children: [" +
        childMappings
          .map(({ tag, compClass }) => `{tag:"${tag}",compClass:${compClass}}`)
          .join(",") +
        "]"
      : "";

  const classDef =
    `class ${canonical} extends ChocolaComponent {\n` +
    `  constructor() {\n` +
    `    super({\n` +
    `      template: \`${escapeForTemplateLiteral(template)}\`,\n` +
    `      hash: "${cssId}",\n` +
    `      props: ${propsPart}${runtimePart}${childrenPart}\n` +
    `    });\n` +
    `  }\n` +
    `}`;

  cx.csrGenerating.delete(module.id);
  cx.csrClasses.set(key, classDef);
}

/**
 * Render one module instance.
 *
 * @param {import("./module-graph.js").ChocolaModule} module
 * @param {Element|null} usageElement null for the root component
 * @param {ProcessContext} cx
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

function serializeRuntimeContext(ctx) {
  const seen = new WeakSet();
  try {
    const json = JSON.stringify(ctx, (key, value) => {
      if (typeof value === "function") return undefined;
      if (typeof value === "object" && value !== null) {
        if (typeof value.nodeType === "number") return undefined;
        if (seen.has(value)) return undefined;
        seen.add(value);
      }
      return value;
    });
    return json || "{}";
  } catch {
    return "{}";
  }
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

function hasModuleChunk(module, cx) {
  return Boolean(module?.template && cx.classNames.has(module.id));
}

function resolveImportedModule(module, imp, graph) {
  const sourcePath = path.resolve(path.dirname(module.sourcePath), imp.source);
  for (const candidate of graph.modules.values()) {
    if (candidate.sourcePath === sourcePath) return candidate;
  }
  return null;
}

/**
 * Build the metadata consumed by `generateRuntime()`.
 *
 * - one entry per module with a CSR class or `$runtime`;
 * - non-`.chjs` imports preserved verbatim;
 * - `.chjs` imports replaced by canonical class imports.
 */
export function buildModuleChunks(graph, cx) {
  const chunks = [];

  for (const id of [...graph.modules.keys()].sort()) {
    const module = graph.moduleById(id);
    const canonical = cx.classNames.get(id) || null;
    const classSource = canonical
      ? cx.csrClasses.get(`${id}#${canonical}`) || null
      : null;
    const runtimeSource = cx.runtimeFunctions.get(id) || null;

    if (!classSource && !runtimeSource) continue;

    const componentImports = [];
    const sideEffectImports = [];
    const seenImports = new Set();

    for (const imp of module.imports || []) {
      if (!isChjsSource(imp.source)) continue;

      const specifiers = imp.specifiers || [];
      if (specifiers.length === 0) {
        const child = resolveImportedModule(module, imp, graph);
        if (child && hasModuleChunk(child, cx)) {
          sideEffectImports.push(child.id);
        }
        continue;
      }

      for (const specifier of specifiers) {
        if (!specifier.local || specifier.type === "namespace") continue;
        const childId = module.importMap.get(specifier.local.toLowerCase());
        const child = childId ? graph.moduleById(childId) : null;
        if (!child || !hasModuleChunk(child, cx)) continue;

        const key = `${child.id}#${specifier.local}`;
        if (seenImports.has(key)) continue;
        seenImports.add(key);
        componentImports.push({
          childId: child.id,
          local: specifier.local,
          canonical: canonicalClassName(child),
        });
      }
    }

    if (module.template) {
      for (const tag of scanTemplateTags(module.template)) {
        if (!tag.lowerName.includes(":")) continue;
        const child = resolveModuleForTag(module, tag.lowerName, graph);
        if (!child || !hasModuleChunk(child, cx)) continue;

        const key = `${child.id}#`;
        if (seenImports.has(key)) continue;
        seenImports.add(key);
        componentImports.push({
          childId: child.id,
          local: null,
          canonical: canonicalClassName(child),
        });
      }
    }

    chunks.push({
      id,
      canonical,
      classSource,
      runtimeSource,
      imports: cx.usedImports.get(id) || [],
      componentImports,
      sideEffectImports,
    });
  }

  return chunks;
}
