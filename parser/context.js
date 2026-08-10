import { compileExpr } from "./utils.js";
import { restoreTemplateChars } from "../utils.js";

export function extractCtxFromEl(element) {
  const ctx = {};
  for (const attr of element.attributes) {
    const key = attr.name;
    const val = restoreTemplateChars(attr.value);
    if (!val.includes("{")) { ctx[key] = val; continue; }
    const matches = [...val.matchAll(/\{([^}]+)\}/g)];
    if (matches.length === 1 && matches[0][0] === val) {
      try {
        ctx[key] = compileExpr(matches[0][1], false)();
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
