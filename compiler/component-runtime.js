import {
  computeReachable,
  extractPropsDefaults,
  extractRuntime,
  extractTopLevelFunctions,
  extractTopLevelVariables,
  parseScript,
} from "../parser/index.js";
import { RUNTIME_KW } from "./component-utils.js";

export function runtimeReach(module, cx, bindingNames) {
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
export function buildRuntimeSource(module, cx, bindings, mode) {
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

export function serializeRuntimeContext(ctx) {
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
