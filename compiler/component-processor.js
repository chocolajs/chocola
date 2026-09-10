import path from "path";
import { parseHTML } from "linkedom";
import { protectCurlyBraces } from "../utils.js";
import { genRandomId, runtimeFunctionId, throwError, deterministicHash, warnConstantCondition, warnUnusedDeclaration, findElementLine } from "./utils.js";
import {
  extractPropsDefaults, extractRuntime, extractTopLevelFunctions, extractTopLevelVariables, parseScript, computeReachable,
  extractCtxFromEl, hasMountIf, getMountIf,
  reservedAttrs, validateChainStructure, applyConditionalToElement, interpolateNode,
  scopeCss, compileExpr, evaluateConstant,
} from "../parser/index.js";
import chalk from "./chalk.js";



class ProcessContext {
  constructor(loadedComponents, runtimeChunks, compIdColl, runtimeMap, cssScopes, cssScopesMap, scopedStyles, staticCtxRegistry, csrClasses) {
    this.loadedComponents = loadedComponents;
    this.runtimeChunks = runtimeChunks;
    this.compIdColl = compIdColl;
    this.runtimeMap = runtimeMap;
    this.cssScopes = cssScopes;
    this.cssScopesMap = cssScopesMap;
    this.scopedStyles = scopedStyles;
    this.staticCtxRegistry = staticCtxRegistry;
    this.csrClasses = csrClasses;
    this.unusedWarned = new Set();
  }
}

function escapeForTemplateLiteral(str) {
  return str.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\${/g, "\\${");
}

function parseFragment(html, doc) {
  const fragment = doc.createDocumentFragment();
  const temp = doc.createElement("div");
  temp.innerHTML = html;
  const children = [...temp.childNodes];
  for (const child of children) {
    fragment.appendChild(child);
  }
  return fragment;
}

function generateCSRClass(compName, cx, explicitClassName) {
  if (cx.csrClasses.has(compName)) return;

  let instance = cx.loadedComponents.get(compName);
  if (!instance) return;

  instance = protectCurlyBraces(instance);
  const dom = parseHTML(instance);
  const doc = dom.document;
  const script = doc.querySelector("script")?.innerHTML;
  const template = doc.querySelector("template")?.innerHTML;
  const styles = doc.querySelector("style")?.innerHTML;

  if (!template) return;

  const compProps = extractPropsDefaults(script);
  const topFuncSrc = extractTopLevelFunctions(script || "", RUNTIME_KW);
  const topVars = extractTopLevelVariables(script || "");
  let runtime = extractRuntime(script || "", compName);

  if (!cx.cssScopesMap.has(compName)) {
    cx.cssScopesMap.set(compName, deterministicHash(compName, 8));
  }
  const cssId = cx.cssScopesMap.get(compName);

  if (styles) {
    cx.scopedStyles.push(scopeCss(styles, cssId));
  }

  const childMappings = [];
  const bindVarNames = new Set();
  const templateDoc = parseFragment(template, doc);
  const seenTags = new Set();
  for (const el of templateDoc.querySelectorAll("*")) {
    const tag = el.tagName.toLowerCase();
    if (!seenTags.has(tag)) {
      seenTags.add(tag);
      const childCompName = tag + ".html";
      if (cx.loadedComponents.has(childCompName)) {
        generateCSRClass(childCompName, cx);
        const childClassName = childCompName.replace(".html", "").replace(/^\w/, c => c.toUpperCase());
        childMappings.push({ tag, compClass: childClassName });
      }
    }
    for (const attr of el.attributes) {
      if (attr.name.startsWith("bind:")) {
        bindVarNames.add(attr.value);
      }
    }
  }

  let csrRuntimeSource = null;
  // Compute reachable for client bundling (Step B)
  const parsedForReach = parseScript(script || "");
  let reach = null;
  if (parsedForReach.ast && runtime) {
    reach = computeReachable(parsedForReach, { bindings: [...bindVarNames] });
    if (reach.fallback) {
      // conservative: include all and warn
      console.warn(chalk.yellow(`WARN ${compName} — dynamic $runtime, including all declarations`));
    }
  }
  const injectedNames = new Set(compProps.map(p => p.name));
  for (const varName of bindVarNames) injectedNames.add(varName);
  let topVarsToInject = topVars.filter(v => !injectedNames.has(v.name));
  let propsToInject = compProps;
  let funcsToInject = topFuncSrc;
  let bindingsToInject = [...bindVarNames];
  if (reach && !reach.fallback) {
    const neededVarNames = new Set(reach.neededVars.flatMap(v => v.names));
    const neededPropNames = new Set(reach.neededProps.map(p => p.name));
    const neededFuncNames = new Set(reach.neededFuncs.map(src => {
      const m = src.match(/^(?:async\s+)?function\s+([a-zA-Z_$][0-9a-zA-Z_$]*)/);
      return m ? m[1] : null;
    }).filter(Boolean));
    const neededBindingSet = new Set(reach.neededBindings);
    // Filter to reachable only
    propsToInject = compProps.filter(p => neededPropNames.has(p.name));
    topVarsToInject = topVars.filter(v => neededVarNames.has(v.name) && !injectedNames.has(v.name));
    funcsToInject = topFuncSrc.filter(src => {
      const m = src.match(/^(?:async\s+)?function\s+([a-zA-Z_$][0-9a-zA-Z_$]*)/);
      return m && neededFuncNames.has(m[1]);
    });
    bindingsToInject = [...bindVarNames].filter(b => neededBindingSet.has(b));
  }
  if (runtime) {
    let injectCode = "";
    for (const { name, defaultValue } of propsToInject) {
      if (defaultValue !== undefined) {
        injectCode += `let ${name} = ctx.${name}??(${defaultValue});\n`;
      } else {
        injectCode += `let ${name} = ctx.${name};\n`;
      }
    }
    for (const { keyword, name, value } of topVarsToInject) {
      if (value !== undefined) {
        injectCode += `${keyword} ${name} = ctx.${name}??(${value});\n`;
      } else {
        injectCode += `${keyword} ${name};\n`;
      }
    }
    for (const varName of bindingsToInject) {
      if (varName !== "self") {
        injectCode += `let ${varName} = ctx.${varName};\n`;
      }
    }
    if (funcsToInject.length > 0) {
      injectCode += "\n" + funcsToInject.join("\n\n") + "\n";
    }
    runtime = runtime.replace(/\$runtime\([^)]*\)\s*\{/, match => match + "\n" + injectCode);
    runtime = runtime.replace(`${RUNTIME_KW}()`, `function(self, ctx)`);
    csrRuntimeSource = runtime.replace(/^(async\s+)?function\s+\w+/, "$1function");
  }

  const className = explicitClassName || compName.replace(".html", "").replace(/^\w/, c => c.toUpperCase());
  const propsParts = [];
  // For CSR class props: when runtime exists, include only reachable; otherwise keep all (fallback for CSR-only)
  let propsForClass = compProps;
  let varsForClass = topVarsToInject;
  if (runtime && reach && !reach.fallback) {
    propsForClass = propsToInject;
    varsForClass = topVarsToInject;
  }
  for (const { name, defaultValue } of propsForClass) {
    propsParts.push(`${JSON.stringify(name)}: ${defaultValue !== undefined ? defaultValue : "null"}`);
  }
  for (const { name, value } of varsForClass) {
    if (value !== undefined) {
      propsParts.push(`${JSON.stringify(name)}: ${value}`);
    }
  }

  const childrenPart = childMappings.length > 0
    ? ",\n      children: [" + childMappings.map(m => `{tag:"${m.tag}",compClass:${m.compClass}}`).join(",") + "]"
    : "";
  const runtimePart = csrRuntimeSource ? `,\n      runtime: ${csrRuntimeSource}` : "";
  const propsPart = propsParts.length > 0 ? `{ ${propsParts.join(", ")} }` : "{}";
  const classDef = `class ${className} extends ChocolaComponent {\n  constructor() {\n    super({\n      template: \`${escapeForTemplateLiteral(template)}\`,\n      hash: "${cssId}",\n      props: ${propsPart}${runtimePart}${childrenPart}\n    });\n  }\n}`;
  cx.csrClasses.set(compName, classDef);
}

const BARE_IDENTIFIER_RE = /(?<![.\w$])[a-zA-Z_$][0-9a-zA-Z_$]*/g;
const PROPERTY_IDENTIFIER_RE = /\.([a-zA-Z_$][0-9a-zA-Z_$]*)/g;

function countIdentifiers(text, counts) {
  for (const re of [BARE_IDENTIFIER_RE, PROPERTY_IDENTIFIER_RE]) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) counts.set(m[1] ?? m[0], (counts.get(m[1] ?? m[0]) || 0) + 1);
  }
  return counts;
}

function escapeNameForRegex(name) {
  return name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findLineInSource(source, regex) {
  const match = regex.exec(source);
  if (!match) return null;
  return source.substring(0, match.index).split("\n").length;
}

function warnUnusedDeclarations(cx, compName, instance, script, fragment) {
  if (!script && !fragment.querySelector("[bind\\:]")) return;
  if (cx.unusedWarned.has(compName)) return;
  cx.unusedWarned.add(compName);

  const props = extractPropsDefaults(script).map(p => p.name);
  const topVars = extractTopLevelVariables(script).map(v => v.name);
  const topFuncs = extractTopLevelFunctions(script, RUNTIME_KW)
    .map(src => src.match(/^(?:async\s+)?function\s+([a-zA-Z_$][0-9a-zA-Z_$]*)/)?.[1])
    .filter(Boolean);

  const bindings = [];
  for (const el of fragment.querySelectorAll("*")) {
    for (const attr of el.attributes) {
      if (attr.name.startsWith("bind:")) bindings.push({ name: attr.value, element: el });
    }
  }

  const counts = new Map();
  if (script) countIdentifiers(script, counts);

  const walk = (node) => {
    if (node.nodeType === 3) {
      for (const m of node.textContent.matchAll(/\{([^}]+)\}/g)) countIdentifiers(m[1], counts);
      return;
    }
    if (node.attributes) {
      for (const attr of node.attributes) {
        if (attr.name.startsWith("bind:")) {
          countIdentifiers(attr.value, counts);
        } else {
          for (const m of attr.value.matchAll(/\{([^}]+)\}/g)) countIdentifiers(m[1], counts);
        }
      }
    }
    for (const child of node.childNodes) walk(child);
  };
  walk(fragment);

  const isUnused = (name) => (counts.get(name) || 0) <= 1;
  const warn = (kind, name, declRegex) => {
    const lineNum = findLineInSource(instance, declRegex);
    warnUnusedDeclaration(lineNum !== null ? `${compName}:${lineNum}` : compName, kind, name);
  };

  for (const name of props) {
    if (isUnused(name)) warn("prop", name, new RegExp("export\\s+let\\s+" + escapeNameForRegex(name) + "\\b"));
  }
  for (const name of topVars) {
    if (isUnused(name)) warn("variable", name, new RegExp("(?:^|[^\\w])(?:let|const)\\s+" + escapeNameForRegex(name) + "\\b"));
  }
  for (const name of topFuncs) {
    if (isUnused(name)) warn("function", name, new RegExp("(?:async\\s+)?function\\s+" + escapeNameForRegex(name) + "\\b"));
  }
  const seenBindings = new Set();
  for (const { name, element } of bindings) {
    if (seenBindings.has(name)) continue;
    seenBindings.add(name);
    if (isUnused(name)) {
      const lineNum = findElementLine(instance, element.outerHTML);
      warnUnusedDeclaration(lineNum !== null ? `${compName}:${lineNum}` : compName, "binding", name);
    }
  }
}

export function processComponentElement(
  element,
  cx,
  renderChain = [],
  sourceFile,
  sourceContent,
  globalCtx = {}
) {
  const tagName = element.tagName.toLowerCase();
  const compName = tagName + ".html";
  let instance = cx.loadedComponents.get(compName);

  if (!instance || instance === undefined) return false;
  if (renderChain && renderChain.includes(compName)) return false;

  instance = protectCurlyBraces(instance);
  const dom = parseHTML(instance);
  const doc = dom.document;
  let script = doc.querySelector("script")?.innerHTML;
  let template = doc.querySelector("template")?.innerHTML;
  let styles = doc.querySelector("style")?.innerHTML;

  if (!template) {
    console.warn(chalk.yellow(`${compName} — component is missing a <template>`));
    return false;
  }

  // Store original script for reachability (before stripping)
  const originalScriptForReach = script;
  if (script) {
    const parsed = parseScript(script);
    if (parsed.ast && parsed.imports.length > 0) {
      // Determine needed imports via reachability (Step B)
      let importsToGenerate = parsed.imports;
      if (parsed.runtimeNode) {
        const reachForImports = computeReachable(parsed, { bindings: [] });
        if (!reachForImports.fallback) {
          const neededSet = new Set(reachForImports.neededImports);
          importsToGenerate = parsed.imports.filter(imp => neededSet.has(imp));
        }
      } else {
        // No runtime -> no client imports needed (server-only)
        importsToGenerate = [];
      }
      for (const imp of importsToGenerate) {
        const importedCompName = path.basename(imp.source).toLowerCase();
        if (cx.loadedComponents.has(importedCompName)) {
          if (imp.specifiers.length === 0) {
            generateCSRClass(importedCompName, cx);
          } else {
            for (const spec of imp.specifiers) {
              generateCSRClass(importedCompName, cx, spec.local);
            }
          }
        }
      }
      const sorted = [...parsed.imports].sort((a, b) => b.start - a.start);
      for (const imp of sorted) {
        script = script.slice(0, imp.start) + script.slice(imp.end);
      }
    } else if (parsed.parseError) {
      const importRegex = /import\s+(\w+)\s+from\s+['"]([^'"]+)['"]\s*;?\s*/g;
      script = script.replace(importRegex, (_, importedName, importPath) => {
        const importedCompName = path.basename(importPath).toLowerCase();
        if (cx.loadedComponents.has(importedCompName)) {
          generateCSRClass(importedCompName, cx, importedName);
        }
        return "";
      });
    }
  }

  const compProps = extractPropsDefaults(script);

  let ctx;
  if (cx.staticCtxRegistry && cx.staticCtxRegistry.has(element)) {
    ctx = cx.staticCtxRegistry.get(element);
  } else {
    ctx = extractCtxFromEl(element, globalCtx);
    if (globalCtx && typeof globalCtx === "object") {
      for (const [k, v] of Object.entries(globalCtx)) {
        if (!(k in ctx)) ctx[k] = v;
      }
    }
    cx.staticCtxRegistry && cx.staticCtxRegistry.set(element, ctx);
  }

  if (compProps.length > 0) {
    compProps.forEach(({ name, defaultValue }) => {
      if (defaultValue !== undefined && !(name in ctx)) {
        try {
          ctx[name] = compileExpr(defaultValue, false)();
        } catch {
          ctx[name] = defaultValue;
        }
      }
    });
  }

  const topFuncSrc = extractTopLevelFunctions(script || "", RUNTIME_KW);
  const topVars = extractTopLevelVariables(script || "");
  for (const { name, value } of topVars) {
    if (name in ctx) continue;
    if (value !== undefined) {
      try {
        ctx[name] = compileExpr(value, false)();
      } catch {}
    }
  }
  for (const src of topFuncSrc) {
    try {
      const fn = (0, eval)("(" + src + ")");
      const name = fn.name;
      if (name && !(name in ctx)) ctx[name] = fn;
    } catch {}
  }

  const elInnerHtml = element.innerHTML;

  const ctxProxy = new Proxy(ctx, {
    has() { return true; },
    get(target, key) { return target[key]; }
  });

  const fragment = parseFragment(template, doc);

  warnUnusedDeclarations(cx, compName, instance, script, fragment);

  const slotFragment = parseFragment(elInnerHtml, doc);
  if (sourceFile) {
    validateChainStructure(slotFragment, sourceFile, sourceContent, elInnerHtml);
  }
  validateChainStructure(fragment, instance.__sourceFile || compName, instance, template);
  Array.from(fragment.querySelectorAll("slot")).forEach(slot => {
    slot.replaceWith(slotFragment);
  });

  const childEntries = Array.from(fragment.querySelectorAll("*")).map(el => ({
    el,
    parent: el.parentNode
  }));
  const condChains = new Map();
  const bindings = [];
  const elBindIds = new Map();
  let bindCounter = 0;

  const conditionalLocations = new Map();
  for (const { el } of childEntries) {
    if (!el.hasAttribute("if") && !hasMountIf(el) && !el.hasAttribute("elif")) continue;
    let location = sourceFile;
    if (instance) {
      const lineNum = findElementLine(instance, el.outerHTML);
      if (lineNum !== null) location = `${compName}:${lineNum}`;
    }
    if (location === sourceFile && sourceContent) {
      const lineNum = findElementLine(sourceContent, el.outerHTML);
      if (lineNum !== null) location = `${sourceFile}:${lineNum}`;
    }
    conditionalLocations.set(el, location);
  }

  childEntries.forEach(({ el: child, parent }) => {
    if (!condChains.has(parent)) {
      condChains.set(parent, { active: false, rendered: false });
    }
    const condChain = condChains.get(parent);

    const hasIf = child.hasAttribute("if");
    const hasDelIf = hasMountIf(child);
    const hasElif = child.hasAttribute("elif");
    const hasElse = child.hasAttribute("else");

    if (hasIf || hasDelIf || hasElif) {
      const location = conditionalLocations.get(child) || sourceFile;
      const stripBraces = (raw) => raw.startsWith("{") ? raw.slice(1, -1) : raw;
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
        throwError(`${instance.__sourceFile || compName}: <${child.tagName.toLowerCase()}> has ${hasElif ? "elif" : "else"} without a preceding if/mount:if sibling`);
      }
      if (condChain.rendered) {
        child.remove();
        if (hasElse) {
          condChain.active = false;
        }
        return;
      }
    }

    if (child.tagName.toLowerCase() === "void") {
      if (hasElif || hasElse) {
        if (hasElif) {
          const expr = child.getAttribute("elif").slice(1, -1);
          const fn = compileExpr(expr, true);
          if (!fn(ctxProxy)) {
            child.remove();
            return;
          }
        }
        child.replaceWith(...child.children);
        condChain.rendered = true;
        if (hasElse) {
          condChain.active = false;
        }
      } else if (hasIf || hasDelIf) {
        const raw = hasIf ? child.getAttribute("if") : getMountIf(child);
        const expr = raw.slice(1, -1);
        const fn = compileExpr(expr, true);
        condChain.active = true;
        if (fn(ctxProxy)) {
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

    Array.from(child.attributes).forEach(attribute => {
      if (!attribute || attribute === undefined) return;
      if (reservedAttrs.includes(attribute.name)) return;

      if (attribute.name.startsWith("bind:")) {
        const prop = attribute.name.slice(5);
        const varName = attribute.value;
        let bindId = elBindIds.get(child);
        if (!bindId) {
          bindId = "b" + (bindCounter++);
          elBindIds.set(child, bindId);
          child.setAttribute("data-chbind-" + bindId, "");
        }
        bindings.push({ prop, varName, bindId });
        child.removeAttribute(attribute.name);
        return;
      }

      child.setAttribute(
        attribute.name,
        attribute.value.replace(
          /\{([^}]+)\}/g,
          (_, expr) => {
            try {
              return compileExpr(expr, true)(ctxProxy);
            } catch {
              return "";
            }
          }
        )
      );
    });

    const condAttrs = {};
    if (hasIf) condAttrs["if"] = child.getAttribute("if");
    if (hasDelIf) condAttrs["mount:if"] = getMountIf(child);
    if (hasElif) condAttrs["elif"] = child.getAttribute("elif");
    if (hasElse) condAttrs["else"] = "";

    const processed = processComponentElement(
      child,
      cx,
      renderChain.concat(compName),
      compName,
      template,
      globalCtx
    );

    let condTarget = child;
    if (processed && processed.nodeType === 1) {
      condTarget = processed;
      for (const [name, value] of Object.entries(condAttrs)) {
        condTarget.setAttribute(name, value);
      }
    }

    applyConditionalToElement(condTarget, ctxProxy, condChain, hasIf, hasDelIf, hasElif, hasElse);

    interpolateNode(condTarget, ctxProxy)
  });

  let csrRuntimeSource = null;
  const firstChild = fragment.children[0];

  if (firstChild && firstChild.nodeType === 1) {
    if (script) {
      const compId = "chid-" + deterministicHash(compName + ":" + cx.compIdColl.length, 8);
      cx.compIdColl.push(compId);
      firstChild.setAttribute("chid", compId);

      const ctxRegex = /ctx\s*=\s*({.*?})/;
      const ctxMatch = script.match(ctxRegex);
      let runtimeCtx = {};
      if (ctxMatch) {
        try {
          runtimeCtx = JSON.parse(ctxMatch[1].replace(/(\w+):/g, '"$1":'));
        } catch (e) {
          runtimeCtx = {};
        }
      }
      const ctxDefParts = [];
      const declared = new Set();
      for (const [key, value] of Object.entries(runtimeCtx)) {
        ctxDefParts.push(`let ${key} = ctx.${key}??${JSON.stringify(value)};\n`);
        declared.add(key);
      }

      for (const { name, defaultValue } of compProps) {
        if (declared.has(name)) continue;
        if (defaultValue !== undefined) {
          ctxDefParts.push(`let ${name} = ctx.${name}??(${defaultValue});\n`);
        } else {
          ctxDefParts.push(`let ${name} = ctx.${name};\n`);
        }
      }

      const ctxDef = ctxDefParts.join("");

      script = script.replace(ctxRegex, "ctx");

      let runtime = extractRuntime(script, compName);

      if (runtime) {
        let fnEntry = cx.runtimeMap && cx.runtimeMap.get(compName);
        let fnId;
        if (!fnEntry) {
          fnId = runtimeFunctionId(compName);
          // Step B: filter to client-reachable declarations
          let reachInject = null;
          if (originalScriptForReach) {
            const parsedReach = parseScript(originalScriptForReach);
            if (parsedReach.ast) {
              const bindNames = bindings.map(b => b.varName);
              reachInject = computeReachable(parsedReach, { bindings: bindNames });
              if (reachInject.fallback) {
                console.warn(chalk.yellow(`WARN ${compName} — dynamic $runtime, including all declarations`));
                reachInject = null;
              }
            }
          }
          // Prepare filtered sets
          let compPropsToInject = compProps;
          let topVarsToInject = topVars;
          let bindingsToInject = bindings;
          let topFuncsToInject = topFuncSrc;
          if (reachInject) {
            const neededPropNames = new Set(reachInject.neededProps.map(p => p.name));
            const neededVarNames = new Set(reachInject.neededVars.flatMap(v => v.names));
            const neededBindingSet = new Set(reachInject.neededBindings);
            const neededFuncNames = new Set(reachInject.neededFuncs.map(src => {
              const m = src.match(/^(?:async\s+)?function\s+([a-zA-Z_$][0-9a-zA-Z_$]*)/);
              return m ? m[1] : null;
            }).filter(Boolean));
            // Rebuild ctxDef filtered to needed props (inject only reachable props)
            // Note: declared handling below will be updated to use filtered props
            compPropsToInject = compProps.filter(p => neededPropNames.has(p.name));
            topVarsToInject = topVars.filter(v => neededVarNames.has(v.name));
            bindingsToInject = bindings.filter(b => neededBindingSet.has(b.varName));
            topFuncsToInject = topFuncSrc.filter(src => {
              const m = src.match(/^(?:async\s+)?function\s+([a-zA-Z_$][0-9a-zA-Z_$]*)/);
              return m && neededFuncNames.has(m[1]);
            });
            // Rebuild ctxDef to only include reachable props
            // declared already has runtimeCtx keys; now add only needed props
            // Recreate ctxDef parts filtered
            const ctxDefPartsFiltered = [];
            const declaredForCtx = new Set(Object.keys(runtimeCtx));
            for (const { name, defaultValue } of compPropsToInject) {
              if (declaredForCtx.has(name)) continue;
              if (defaultValue !== undefined) {
                ctxDefPartsFiltered.push(`let ${name} = ctx.${name}??(${defaultValue});\n`);
              } else {
                ctxDefPartsFiltered.push(`let ${name} = ctx.${name};\n`);
              }
              declaredForCtx.add(name);
            }
            // Prepend runtimeCtx parts (already in ctxDefParts) but we need to reconstruct
            // Simpler: rebuild ctxDef from scratch filtered
            const runtimeCtxParts = [];
            for (const [k,v] of Object.entries(runtimeCtx)) {
              runtimeCtxParts.push(`let ${k} = ctx.${k}??${JSON.stringify(v)};\n`);
            }
            const filteredCtxDef = runtimeCtxParts.join("") + ctxDefPartsFiltered.join("");
            // Use filtered ctxDef for injection
            // declared set for topVars should include runtimeCtx + needed props + bindingsToInject
            // We'll set injectCode later using filteredCtxDef
            // Override ctxDef and declared handling
            // Store for later use
            reachInject._filteredCtxDef = filteredCtxDef;
            reachInject._compPropsToInject = compPropsToInject;
            reachInject._topVarsToInject = topVarsToInject;
            reachInject._bindingsToInject = bindingsToInject;
            reachInject._topFuncsToInject = topFuncsToInject;
          }

          let injectCode;
          let effectiveTopVars;
          let effectiveBindings;
          let effectiveFuncs;
          if (reachInject && reachInject._filteredCtxDef !== undefined) {
            injectCode = reachInject._filteredCtxDef;
            // declared for topVars filtering should include runtimeCtx + needed props + needed bindings
            const filteredDeclared = new Set([...Object.keys(runtimeCtx), ...reachInject._compPropsToInject.map(p=>p.name), ...reachInject._bindingsToInject.map(b=>b.varName)]);
            effectiveTopVars = reachInject._topVarsToInject.filter(v => !filteredDeclared.has(v.name));
            effectiveBindings = reachInject._bindingsToInject;
            effectiveFuncs = reachInject._topFuncsToInject;
          } else {
            injectCode = ctxDef;
            for (const b of bindings) declared.add(b.varName);
            effectiveTopVars = topVars.filter(v => !declared.has(v.name));
            effectiveBindings = bindings;
            effectiveFuncs = topFuncSrc;
          }
          if (effectiveTopVars.length > 0) {
            injectCode += "\n" + effectiveTopVars.map(v => v.value !== undefined
              ? `${v.keyword} ${v.name} = ctx.${v.name}??(${v.value});`
              : `${v.keyword} ${v.name};`
            ).join("\n") + "\n";
          }
          if (effectiveBindings.length > 0) {
            injectCode += "\n" + effectiveBindings.map(b => {
              const accessor = b.prop === "self" ? "" : "." + b.prop;
              return "let " + b.varName + " = self.querySelector('[data-chbind-" + b.bindId + "]')" + accessor + ";";
            }).join("\n") + "\n";
          }
          if (effectiveFuncs.length > 0) {
            injectCode += "\n" + effectiveFuncs.join("\n\n") + "\n";
          }
          runtime = runtime.replace(/\$runtime\([^)]*\)\s*\{/, match => match + "\n" + injectCode);

          runtime = runtime.replace(`${RUNTIME_KW}()`, `${fnId}(self, ctx)`);
          csrRuntimeSource = runtime.replace(/^function\s+\w+/, "function");
          cx.runtimeChunks.push(runtime);
          cx.runtimeMap && cx.runtimeMap.set(compName, { fnId });
        } else {
          fnId = fnEntry.fnId;
        }

        cx.runtimeChunks.push(`${fnId}(document.querySelector('[chid="${compId}"]'), ${JSON.stringify(ctx)});`);
      }
    }
  }

  let cssId = cx.cssScopesMap && cx.cssScopesMap.get(compName);
  if (!cssId) {
    cssId = deterministicHash(compName, 8);
    cx.cssScopesMap.set(compName, cssId);
  }
  if (fragment.children.length === 1 && firstChild.nodeType === 1) {
    firstChild.classList.add(cssId);
  }
  if (styles) {
    styles = scopeCss(styles, cssId);
    cx.scopedStyles.push(styles);
  }

  if (csrRuntimeSource && !cx.csrClasses.has(compName)) {
    generateCSRClass(compName, cx);
  }

  if (element.style.display === "none" && firstChild && firstChild.nodeType === 1) {
    firstChild.style.display = "none";
  }

  element.replaceWith(fragment);
  return firstChild && firstChild.nodeType === 1 ? firstChild : true;
}

export function processAllComponents(appElements, loadedComponents, pageSourceFile, pageSourceContent, globalCtx = {}) {
  const cx = new ProcessContext(
    loadedComponents, [], [], new Map(), [], new Map(), [], new Map(), new Map()
  );

  for (const [compName, instance] of cx.loadedComponents) {
    const scriptMatch = instance.match(/<script>([\s\S]*?)<\/script>/i);
    if (scriptMatch) {
      const scriptContent = scriptMatch[1];
      const parsed = parseScript(scriptContent);
      if (parsed.ast) {
        let importsToGenerate = parsed.imports;
        if (parsed.runtimeNode) {
          const reach = computeReachable(parsed, { bindings: [] });
          if (!reach.fallback) {
            const neededSet = new Set(reach.neededImports);
            importsToGenerate = parsed.imports.filter(imp => neededSet.has(imp));
          }
        } else {
          importsToGenerate = [];
        }
        for (const imp of importsToGenerate) {
          const importedCompName = path.basename(imp.source).toLowerCase();
          if (cx.loadedComponents.has(importedCompName)) {
            if (imp.specifiers.length === 0) {
              generateCSRClass(importedCompName, cx);
            } else {
              for (const spec of imp.specifiers) {
                generateCSRClass(importedCompName, cx, spec.local);
              }
            }
          }
        }
      } else {
        const importRegex = /import\s+(\w+)\s+from\s+['"]([^'"]+)['"]\s*;?\s*/g;
        let match;
        while ((match = importRegex.exec(scriptContent)) !== null) {
          const importedName = match[1];
          const importedCompName = path.basename(match[2]).toLowerCase();
          if (cx.loadedComponents.has(importedCompName)) {
            generateCSRClass(importedCompName, cx, importedName);
          }
        }
      }
    }
  }

  appElements.forEach(el => {
    if (!el.isConnected) return;
    processComponentElement(el, cx, [], pageSourceFile, pageSourceContent, globalCtx);
  });
  const runtimeScript = cx.runtimeChunks.join("\n");
  const hasComponents = cx.runtimeChunks.length > 0;
  const scopesCss = cx.scopedStyles.join("\n");
  const csrClasses = [...cx.csrClasses.values()].join("\n\n");

  const hashMap = {};
  for (const [compName, hash] of cx.cssScopesMap) {
    hashMap[compName] = hash;
  }

  return { runtimeScript, hasComponents, scopesCss, hashMap, csrClasses };
}

const RUNTIME_KW = "$runtime";
