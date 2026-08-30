import { compileExpr } from "./utils.js";
import { restoreTemplateChars } from "../utils.js";

export function extractCtxFromEl(element, globalCtx = null) {
  const ctx = {};
  const proxy = globalCtx
    ? new Proxy(globalCtx, { has() { return true; }, get(t, k) { return t[k]; } })
    : null;
  for (const attr of element.attributes) {
    const key = attr.name;
    const val = restoreTemplateChars(attr.value);
    if (!val.includes("{")) { ctx[key] = val; continue; }
    const matches = [...val.matchAll(/\{([^}]+)\}/g)];
    if (matches.length === 1 && matches[0][0] === val) {
      try {
        if (proxy) {
          ctx[key] = compileExpr(matches[0][1], true)(proxy);
        } else {
          ctx[key] = compileExpr(matches[0][1], false)();
        }
        continue;
      } catch {}
      // If evaluation with globalCtx fails, keep raw braces for later interpolation
    }
    if (proxy) {
      // Interpolate any braces using globalCtx for string props like "Hello {name}"
      try {
        ctx[key] = val.replace(/\{([^}]+)\}/g, (_, expr) => {
          try { return String(compileExpr(expr, true)(proxy)); } catch { return ""; }
        });
        continue;
      } catch {}
    }
    ctx[key] = val;
  }
  return ctx;
}

export function hasMountIf(el) {
  return el.hasAttribute("mount:if");
}
export function getMountIf(el) {
  return el.getAttribute("mount:if");
}
export function removeMountIf(el) {
  el.removeAttribute("mount:if");
}
