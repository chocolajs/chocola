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
        let evaluated;
        if (proxy) {
          evaluated = compileExpr(matches[0][1], true)(proxy);
        } else {
          evaluated = compileExpr(matches[0][1], false)();
        }
        if (evaluated !== undefined) {
          ctx[key] = evaluated;
        }
        // if evaluated is undefined, leave key unset so component default can apply
        continue;
      } catch {}
      // If evaluation with globalCtx fails, keep raw braces for later interpolation
    }
    if (proxy) {
      // Interpolate any braces using globalCtx for string props like "Hello {name}"
      try {
        const interpolated = val.replace(/\{([^}]+)\}/g, (_, expr) => {
          try {
            const v = compileExpr(expr, true)(proxy);
            return v === undefined ? "" : String(v);
          } catch { return ""; }
        });
        // If interpolation left empty and original had only braces, don't set to avoid "undefined"
        if (interpolated !== "" || !val.match(/^\{[^}]+\}$/)) {
          ctx[key] = interpolated;
        }
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
