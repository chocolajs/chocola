import { restoreTemplateChars } from "../utils.js";

const compiledCache = new Map();

export function compileExpr(expr, useCtx) {
  expr = restoreTemplateChars(expr);
  const key = useCtx ? `ctx:${expr}` : `raw:${expr}`;
  let fn = compiledCache.get(key);
  if (!fn) {
    fn = useCtx
      ? new Function("ctx", `with(ctx) { return (${expr}); }`)
      : new Function(`"use strict"; return (${expr})`);
    compiledCache.set(key, fn);
  }
  return fn;
}

const constantEvalError = Symbol("constant-eval-error");

export function evaluateConstant(expr) {
  const trap = new Proxy({}, {
    has() { return true; },
    get() { throw constantEvalError; },
  });
  try {
    const fn = compileExpr(expr, true);
    const value = fn(trap);
    return { constant: true, value };
  } catch {
    return { constant: false };
  }
}
