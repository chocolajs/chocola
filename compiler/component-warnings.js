import { restoreCurlyBraces } from "../utils.js";
import {
  extractPropsDefaults,
  extractTopLevelFunctions,
  extractTopLevelVariables,
} from "../parser/index.js";
import { findElementLine, warnUnusedDeclaration } from "./utils.js";
import { RUNTIME_KW } from "./component-utils.js";

function findLineInSource(source, regex) {
  const match = regex.exec(source);
  if (!match) return null;
  return source.substring(0, match.index).split("\n").length;
}

export function findElementLocation(module, element) {
  const outerHTML = restoreCurlyBraces(element.outerHTML);
  const lineNum = findElementLine(module.source, outerHTML);
  return lineNum !== null ? `${module.id}:${lineNum}` : module.id;
}

export function warnUnusedDeclarations(cx, module, fragment) {
  if (cx.unusedWarned.has(module.id)) return;
  if (!module.script && !fragment.querySelector("[bind\\:]")) return;
  cx.unusedWarned.add(module.id);

  const script = module.script || "";
  const props = extractPropsDefaults(script).map((prop) => prop.name);
  const topVars = extractTopLevelVariables(script).map((variable) => variable.name);
  const topFuncs = extractTopLevelFunctions(script, RUNTIME_KW)
    .map(
      (src) =>
        src.match(/^(?:async\s+)?function\s+([a-zA-Z_$][0-9a-zA-Z_$]*)/)?.[1]
    )
    .filter(Boolean);

  const bindings = [];
  for (const el of fragment.querySelectorAll("*")) {
    for (const attr of el.attributes) {
      if (attr.name.startsWith("bind:")) {
        bindings.push({ name: attr.value, element: el });
      }
    }
  }

  const counts = new Map();
  const countIdentifiers = (text) => {
    for (const re of [
      /(?<![.\w$])[a-zA-Z_$][0-9a-zA-Z_$]*/g,
      /\.([a-zA-Z_$][0-9a-zA-Z_$]*)/g,
    ]) {
      re.lastIndex = 0;
      for (const match of text.matchAll(re)) {
        const name = match[1] ?? match[0];
        counts.set(name, (counts.get(name) || 0) + 1);
      }
    }
  };

  if (script) countIdentifiers(script);

  const walk = (node) => {
    if (node.nodeType === 3) {
      for (const match of node.textContent.matchAll(/\{([^}]+)\}/g)) {
        countIdentifiers(match[1]);
      }
      return;
    }
    if (node.attributes) {
      for (const attr of node.attributes) {
        if (attr.name.startsWith("bind:")) {
          countIdentifiers(attr.value);
        } else {
          for (const match of attr.value.matchAll(/\{([^}]+)\}/g)) {
            countIdentifiers(match[1]);
          }
        }
      }
    }
    for (const child of node.childNodes) walk(child);
  };
  walk(fragment);

  const isUnused = (name) => (counts.get(name) || 0) <= 1;
  const warn = (kind, name, declRegex) => {
    const lineNum = findLineInSource(module.source, declRegex);
    warnUnusedDeclaration(
      lineNum !== null ? `${module.id}:${lineNum}` : module.id,
      kind,
      name
    );
  };

  const escape = (name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  for (const name of props) {
    if (isUnused(name)) {
      warn("prop", name, new RegExp("export\\s+let\\s+" + escape(name) + "\\b"));
    }
  }
  for (const name of topVars) {
    if (isUnused(name)) {
      warn(
        "variable",
        name,
        new RegExp("(?:^|[^\\w])(?:let|const|var)\\s+" + escape(name) + "\\b")
      );
    }
  }
  for (const name of topFuncs) {
    if (isUnused(name)) {
      warn(
        "function",
        name,
        new RegExp("(?:async\\s+)?function\\s+" + escape(name) + "\\b")
      );
    }
  }
  const seenBindings = new Set();
  for (const { name, element } of bindings) {
    if (seenBindings.has(name)) continue;
    seenBindings.add(name);
    if (isUnused(name)) {
      const lineNum = findElementLine(module.source, element.outerHTML);
      warnUnusedDeclaration(
        lineNum !== null ? `${module.id}:${lineNum}` : module.id,
        "binding",
        name
      );
    }
  }
}
