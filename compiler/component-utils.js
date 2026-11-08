import { scopeAttribute } from "../parser/index.js";

const CHJS_EXTENSION = ".chjs";

export const RUNTIME_KW = "$runtime";

export function isChjsSource(source) {
  return typeof source === "string" && source.toLowerCase().endsWith(CHJS_EXTENSION);
}

export function tagDescendants(node, cssId) {
  if (!cssId) return;
  const attr = scopeAttribute(cssId);
  for (const el of node.querySelectorAll("*")) {
    el.setAttribute(attr, "");
  }
}
