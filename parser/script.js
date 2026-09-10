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
 *   props: Array<{name:string, defaultValue:string|undefined, raw:string}>,
 *   topVars: Array<{keyword:string, name:string, value:string|undefined, raw:string, names:string[], isDestructuring:boolean, start:number, end:number}>,
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
    // Fallback: return regex-based shims will handle it, but for parseScript we return empty
    // with raw fallback for imports? Try to still extract via regex for graceful degradation.
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
        // export let cases — treat each declarator as a prop
        for (const d of decl.declarations) {
          const names = extractBindingNames(d.id);
          const defaultValue = d.init ? script.slice(d.init.start, d.init.end).trim() : undefined;
          const raw = script.slice(d.start, d.end);
          for (const name of names) {
            // For destructuring, names may be multiple but defaultValue is same init.
            // We push per name to match old behavior where each identifier is a prop.
            props.push({ name, defaultValue, raw });
          }
          // If no names extracted (should not happen), still handle pattern raw
          if (names.length === 0) {
            const patternRaw = script.slice(d.id.start, d.id.end);
            props.push({ name: patternRaw, defaultValue, raw });
          }
        }
      } else if (!decl) {
        // e.g., export { x } — ignore for props collection (no defaults)
      }
      // ignore other export types for now
    } else if (node.type === "VariableDeclaration") {
      // Only top-level; ast.body already ensures top-level
      const keyword = node.kind; // let or const
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
          // Skip if destructuring only binds self/ctx (unlikely but safe)
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
    // Other top-level types (e.g., ExpressionStatement, ClassDeclaration) are ignored for now
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

// Re-export helpers for convenience
export { extractBindingNames };
