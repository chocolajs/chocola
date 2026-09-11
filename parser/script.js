import * as acorn from "acorn";

/**
 * Extract binding names from a pattern node (Identifier, ObjectPattern, ArrayPattern, RestElement, AssignmentPattern)
 * Returns flat list of identifier names.
 */
function extractBindingNames(node) {
  const names = [];
  function walk(n) {
    if (!n) return;
    switch (n.type) {
      case "Identifier":
        names.push(n.name);
        break;
      case "ObjectPattern":
        for (const prop of n.properties) {
          if (prop.type === "RestElement") walk(prop.argument);
          else walk(prop.value);
        }
        break;
      case "ArrayPattern":
        for (const elem of n.elements) {
          if (!elem) continue;
          walk(elem);
        }
        break;
      case "RestElement":
        walk(n.argument);
        break;
      case "AssignmentPattern":
        walk(n.left);
        break;
      default:
        break;
    }
  }
  walk(node);
  return names;
}

/**
 * Parse a <script> block into an ESTree AST and classify top-level declarations.
 *
 * Handles:
 * - export let props (including comma declarators)
 * - let/const with destructuring, comma declarators, array rest
 * - import default/named/namespace/side-effect
 * - function declarations (including async) and $runtime extraction
 *
 * @param {string|null} script - raw script innerHTML or null
 * @returns {{
 *   ast: import("acorn").Program|null,
 *   props: Array<{name:string, defaultValue:string|undefined, raw:string, initNode: any, declaratorNode:any}>,
 *   topVars: Array<{keyword:string, name:string, value:string|undefined, raw:string, names:string[], isDestructuring:boolean, start:number, end:number, initNode:any, declaratorNode:any}>,
 *   topFuncs: string[],
 *   topFuncNodes: import("acorn").FunctionDeclaration[],
 *   imports: Array<{source:string, specifiers:Array<{type:string, local:string, imported?:string}>, raw:string, start:number, end:number}>,
 *   runtimeNode: import("acorn").FunctionDeclaration|null,
 *   runtime: string|null
 * }}
 */
export function parseScript(script) {
  if (!script) {
    return {
      ast: null,
      props: [],
      topVars: [],
      topFuncs: [],
      topFuncNodes: [],
      imports: [],
      runtimeNode: null,
      runtime: null,
    };
  }

  let ast = null;
  try {
    ast = acorn.parse(script, {
      ecmaVersion: 2023,
      sourceType: "module",
      ranges: false,
    });
  } catch (e) {
    return {
      ast: null,
      props: [],
      topVars: [],
      topFuncs: [],
      topFuncNodes: [],
      imports: [],
      runtimeNode: null,
      runtime: null,
      parseError: e.message,
    };
  }

  const props = [];
  const topVars = [];
  const topFuncs = [];
  const topFuncNodes = [];
  const imports = [];
  let runtimeNode = null;
  let runtime = null;

  for (const node of ast.body) {
    if (node.type === "ExportNamedDeclaration") {
      const decl = node.declaration;
      if (decl && decl.type === "VariableDeclaration" && decl.kind === "let") {
        for (const d of decl.declarations) {
          const names = extractBindingNames(d.id);
          const defaultValue = d.init ? script.slice(d.init.start, d.init.end).trim() : undefined;
          const raw = script.slice(d.start, d.end);
          for (const name of names) {
            props.push({ name, defaultValue, raw, initNode: d.init || null, declaratorNode: d });
          }
          if (names.length === 0) {
            const patternRaw = script.slice(d.id.start, d.id.end);
            props.push({ name: patternRaw, defaultValue, raw, initNode: d.init || null, declaratorNode: d });
          }
        }
      } else if (!decl) {
        // e.g., export { x } — ignore
      }
    } else if (node.type === "VariableDeclaration") {
      const keyword = node.kind;
      for (const d of node.declarations) {
        const names = extractBindingNames(d.id);
        const value = d.init ? script.slice(d.init.start, d.init.end).trim() : undefined;
        const raw = script.slice(d.start, d.end);
        const idRaw = script.slice(d.id.start, d.id.end);
        const isDestructuring = d.id.type !== "Identifier";
        if (names.length === 0) {
          continue;
        }
        if (isDestructuring) {
          const filtered = names.filter((n) => n !== "self" && n !== "ctx");
          if (filtered.length === 0) continue;
          topVars.push({
            keyword,
            name: idRaw,
            value,
            raw,
            names: filtered,
            isDestructuring: true,
            start: d.start,
            end: d.end,
            initNode: d.init || null,
            declaratorNode: d,
          });
        } else {
          const name = names[0];
          if (name === "self" || name === "ctx") continue;
          topVars.push({
            keyword,
            name,
            value,
            raw,
            names,
            isDestructuring: false,
            start: d.start,
            end: d.end,
            initNode: d.init || null,
            declaratorNode: d,
          });
        }
      }
    } else if (node.type === "FunctionDeclaration") {
      const name = node.id ? node.id.name : null;
      if (name === "$runtime") {
        runtimeNode = node;
        runtime = script.slice(node.start, node.end);
      } else if (name) {
        topFuncs.push(script.slice(node.start, node.end));
        topFuncNodes.push(node);
      }
    } else if (node.type === "ImportDeclaration") {
      const source = node.source.value;
      const specifiers = node.specifiers.map((s) => {
        if (s.type === "ImportDefaultSpecifier") return { type: "default", local: s.local.name };
        if (s.type === "ImportNamespaceSpecifier") return { type: "namespace", local: s.local.name };
        if (s.type === "ImportSpecifier") return { type: "named", imported: s.imported.name, local: s.local.name };
        return { type: "unknown", local: s.local?.name };
      });
      imports.push({
        source,
        specifiers,
        raw: script.slice(node.start, node.end),
        start: node.start,
        end: node.end,
      });
    }
  }

  return {
    ast,
    props,
    topVars,
    topFuncs,
    topFuncNodes,
    imports,
    runtimeNode,
    runtime,
  };
}

// ---------------------------------------------------------------------------
// Reachability (Step B)
// ---------------------------------------------------------------------------

const GLOBALS = new Set([
  "self", "ctx",
  "document", "window", "globalThis",
  "console", "Math", "Date", "JSON", "Object", "Array", "String", "Number", "Boolean",
  "Promise", "Set", "Map", "WeakMap", "WeakSet", "RegExp", "Error", "Intl", "URL", "URLSearchParams",
  "parseInt", "parseFloat", "isNaN", "isFinite", "decodeURI", "decodeURIComponent", "encodeURI", "encodeURIComponent",
  "eval", "Function",
  "location", "navigator", "history", "localStorage", "sessionStorage", "fetch",
  "alert", "confirm", "prompt",
  "setTimeout", "setInterval", "clearTimeout", "clearInterval", "requestAnimationFrame", "cancelAnimationFrame",
  "queueMicrotask", "structuredClone",
  "undefined", "NaN", "Infinity",
]);

function isDynamicRuntime(runtimeNode, script) {
  // Detect eval("..."), new Function(...), with(...), or computed ctx access with non-literal
  let dynamic = false;
  function walk(n) {
    if (!n || dynamic) return;
    if (n.type === "CallExpression") {
      const callee = n.callee;
      if (callee.type === "Identifier" && (callee.name === "eval" || callee.name === "Function")) dynamic = true;
      if (callee.type === "MemberExpression" && callee.object?.name === "ctx" && callee.computed) {
        // will be handled below as MemberExpression case
      }
    }
    if (n.type === "WithStatement") dynamic = true;
    if (n.type === "MemberExpression" && n.object?.type === "Identifier" && n.object.name === "ctx" && n.computed) {
      // ctx["dyn"+x] or ctx[variable] -> dynamic. If property is Literal string, it's static.
      if (n.property.type !== "Literal" || typeof n.property.value !== "string") dynamic = true;
    }
    for (const key in n) {
      if (["type","start","end","loc","range"].includes(key)) continue;
      const child = n[key];
      if (Array.isArray(child)) child.forEach(c => c && typeof c.type === "string" && walk(c));
      else if (child && typeof child.type === "string") walk(child);
    }
  }
  walk(runtimeNode);
  return dynamic;
}

function collectReferencedIdentifiers(node, outSet) {
  // Walk and collect Identifier references, skipping declarations and non-reference positions
  function walk(n, parent) {
    if (!n || typeof n.type !== "string") return;
    if (n.type === "Identifier") {
      // check if this Identifier is a reference (not declaration)
      let isRef = true;
      if (parent) {
        if (parent.type === "VariableDeclarator" && parent.id === n) isRef = false;
        else if ((parent.type === "FunctionDeclaration" || parent.type === "FunctionExpression" || parent.type === "ArrowFunctionExpression") && parent.params.includes(n)) isRef = false;
        else if ((parent.type === "FunctionDeclaration" || parent.type === "FunctionExpression") && parent.id === n) isRef = false;
        else if (parent.type === "MemberExpression" && parent.property === n && !parent.computed) isRef = false;
        else if (parent.type === "Property" && parent.key === n && !parent.computed) isRef = false;
        else if (parent.type === "ImportSpecifier" || parent.type === "ImportDefaultSpecifier" || parent.type === "ImportNamespaceSpecifier") isRef = false;
        else if (parent.type === "ExportSpecifier") isRef = false;
        else if (parent.type === "LabeledStatement" && parent.label === n) isRef = false;
        else if (parent.type === "CatchClause" && parent.param === n) isRef = false;
        else if (parent.type === "AssignmentPattern" && parent.left === n) isRef = false; // param default pattern left is declaration
      }
      if (isRef) outSet.add(n.name);
      return;
    }
    // Skip traversing into declaration patterns where identifiers are not references
    switch (n.type) {
      case "VariableDeclarator":
        // skip id (pattern), only walk init
        if (n.init) walk(n.init, n);
        return;
      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        // skip params (declarations)
        walk(n.body, n);
        return;
      case "ImportDeclaration":
        return; // skip all
      case "ExportNamedDeclaration":
        if (n.declaration) walk(n.declaration, n);
        return;
      case "MemberExpression":
        walk(n.object, n);
        if (n.computed) walk(n.property, n);
        return;
      case "Property":
        if (n.computed) walk(n.key, n);
        walk(n.value, n);
        return;
      case "MethodDefinition":
        if (n.computed) walk(n.key, n);
        // skip params via FunctionExpression handling already
        walk(n.value, n);
        return;
      default:
        break;
    }
    for (const key in n) {
      if (["type","start","end","loc","range"].includes(key)) continue;
      const child = n[key];
      if (Array.isArray(child)) {
        for (const c of child) if (c && typeof c.type === "string") walk(c, n);
      } else if (child && typeof child.type === "string") {
        walk(child, n);
      }
    }
  }
  walk(node, null);
}

/**
 * Compute client-reachable declarations from $runtime.
 * Transitive closure over vars/funcs/props/imports.
 *
 * @param {ReturnType<typeof parseScript>} parsed
 * @param {{bindings?: string[]}} options
 * @returns {{
 *   neededProps: any[],
 *   neededVars: any[],
 *   neededFuncs: string[],
 *   neededFuncNodes: any[],
 *   neededImports: any[],
 *   neededBindings: string[],
 *   fallback: boolean
 * }}
 */
export function computeReachable(parsed, options = {}) {
  const bindings = options.bindings || [];
  const bindingSet = new Set(bindings);

  // No runtime -> empty (server-only). Fallback not needed.
  if (!parsed.ast || !parsed.runtimeNode) {
    return {
      neededProps: [],
      neededVars: [],
      neededFuncs: [],
      neededFuncNodes: [],
      neededImports: [],
      neededBindings: [],
      fallback: false,
    };
  }

  // Parse error fallback -> include all
  if (parsed.parseError) {
    return {
      neededProps: parsed.props.slice(),
      neededVars: parsed.topVars.slice(),
      neededFuncs: parsed.topFuncs.slice(),
      neededFuncNodes: parsed.topFuncNodes.slice(),
      neededImports: parsed.imports.slice(),
      neededBindings: bindings.slice(),
      fallback: true,
    };
  }

  // Dynamic fallback detection
  if (isDynamicRuntime(parsed.runtimeNode, "")) {
    // Warn and include all
    // console.warn will be done by caller; here just mark fallback
    return {
      neededProps: parsed.props.slice(),
      neededVars: parsed.topVars.slice(),
      neededFuncs: parsed.topFuncs.slice(),
      neededFuncNodes: parsed.topFuncNodes.slice(),
      neededImports: parsed.imports.slice(),
      neededBindings: bindings.slice(),
      fallback: true,
    };
  }

  // Build maps
  const varMap = new Map(); // name -> var entry (for destructuring, multiple names point to same entry)
  for (const v of parsed.topVars) {
    for (const n of v.names) varMap.set(n, v);
  }
  const funcMap = new Map(); // name -> {node, src, idx}
  for (let i = 0; i < parsed.topFuncNodes.length; i++) {
    const node = parsed.topFuncNodes[i];
    const src = parsed.topFuncs[i];
    funcMap.set(node.id.name, { node, src, idx: i });
  }
  const propMap = new Map();
  for (const p of parsed.props) propMap.set(p.name, p);
  const importMap = new Map();
  for (const imp of parsed.imports) {
    for (const s of imp.specifiers) importMap.set(s.local, imp);
  }

  const neededVarNames = new Set();
  const neededFuncNames = new Set();
  const neededPropNames = new Set();
  const neededImportLocals = new Set();
  const neededBindingNames = new Set();
  const worklist = [];

  const runtimeIds = new Set();
  collectReferencedIdentifiers(parsed.runtimeNode.body || parsed.runtimeNode, runtimeIds);
  // Also collect from runtime params? Params are self/ctx globals, ignore

  for (const id of runtimeIds) {
    if (GLOBALS.has(id)) continue;
    if (bindingSet.has(id)) { neededBindingNames.add(id); }
    else if (varMap.has(id)) { if (!neededVarNames.has(id)) { neededVarNames.add(id); worklist.push(id); } }
    else if (funcMap.has(id)) { if (!neededFuncNames.has(id)) { neededFuncNames.add(id); worklist.push(id); } }
    else if (propMap.has(id)) { if (!neededPropNames.has(id)) { neededPropNames.add(id); worklist.push(id); } }
    else if (importMap.has(id)) { if (!neededImportLocals.has(id)) { neededImportLocals.add(id); worklist.push(id); } }
  }

  // BFS transitive
  while (worklist.length) {
    const cur = worklist.shift();
    let deps = new Set();
    if (varMap.has(cur)) {
      const entry = varMap.get(cur);
      if (entry.initNode) collectReferencedIdentifiers(entry.initNode, deps);
    } else if (funcMap.has(cur)) {
      const entry = funcMap.get(cur);
      collectReferencedIdentifiers(entry.node, deps);
      // Remove self-reference to avoid trivial loop (func name inside its own body is not a dep)
      deps.delete(cur);
    } else if (propMap.has(cur)) {
      const entry = propMap.get(cur);
      if (entry.initNode) collectReferencedIdentifiers(entry.initNode, deps);
    } else if (importMap.has(cur)) {
      continue;
    }
    for (const dep of deps) {
      if (GLOBALS.has(dep)) continue;
      if (bindingSet.has(dep)) { neededBindingNames.add(dep); continue; }
      if (varMap.has(dep) && !neededVarNames.has(dep)) { neededVarNames.add(dep); worklist.push(dep); }
      else if (funcMap.has(dep) && !neededFuncNames.has(dep)) { neededFuncNames.add(dep); worklist.push(dep); }
      else if (propMap.has(dep) && !neededPropNames.has(dep)) { neededPropNames.add(dep); worklist.push(dep); }
      else if (importMap.has(dep) && !neededImportLocals.has(dep)) { neededImportLocals.add(dep); worklist.push(dep); }
    }
  }

  // Deduplicate imports/vars that may have multiple names pointing to same entry
  const neededVars = [];
  const seenVarKeys = new Set();
  for (const v of parsed.topVars) {
    const key = v.isDestructuring ? v.raw : v.name;
    if (seenVarKeys.has(key)) continue;
    const isNeeded = v.names.some(n => neededVarNames.has(n));
    if (isNeeded) { neededVars.push(v); seenVarKeys.add(key); }
  }
  const neededFuncs = [];
  const neededFuncNodes = [];
  for (const [name, entry] of funcMap.entries()) {
    if (neededFuncNames.has(name)) {
      neededFuncs.push(entry.src);
      neededFuncNodes.push(entry.node);
    }
  }
  const neededProps = parsed.props.filter(p => neededPropNames.has(p.name));
  const neededImportsSet = new Set();
  for (const local of neededImportLocals) {
    const imp = importMap.get(local);
    if (imp) neededImportsSet.add(imp);
  }
  const neededImports = [...neededImportsSet];
  const neededBindings = bindings.filter(b => neededBindingNames.has(b));

  return {
    neededProps,
    neededVars,
    neededFuncs,
    neededFuncNodes,
    neededImports,
    neededBindings,
    fallback: false,
  };
}

// Re-export helpers for convenience
export { extractBindingNames };
