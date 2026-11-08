import {
  compileExpr,
  extractTopLevelFunctions,
  extractTopLevelVariables,
  parseScript,
} from "../parser/index.js";
import { deterministicHash } from "./utils.js";
import { RUNTIME_KW } from "./component-utils.js";

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

/**
 * Copy top-level script declarations into the server render context so
 * templates can interpolate them.
 */
export function applyTopLevelContext(module, ctx) {
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
