export const SCOPE_ATTR_PREFIX = "data-sc-";

export function scopeAttribute(cssId) {
  return SCOPE_ATTR_PREFIX + cssId;
}

const LEGACY_PSEUDO_ELEMENT_RE = /^(before|after|first-line|first-letter)\b/i;

function splitPseudoElement(sel) {
  let depth = 0;
  for (let i = 0; i < sel.length; i++) {
    const ch = sel[i];
    if (ch === "[" || ch === "(") depth++;
    else if (ch === "]" || ch === ")") { if (depth > 0) depth--; }
    else if (ch === ":" && depth === 0) {
      if (sel[i + 1] === ":" || LEGACY_PSEUDO_ELEMENT_RE.test(sel.slice(i + 1))) {
        return [sel.slice(0, i), sel.slice(i)];
      }
    }
  }
  return [sel, ""];
}

function scopeSelector(sel, cssId) {
  const s = sel.trim();
  if (!s) return s;
  const token = `[${scopeAttribute(cssId)}]`;
  if (s.includes(token)) return s;
  const [head, pseudo] = splitPseudoElement(s);
  return head + token + pseudo;
}

export function scopeCss(cssString, cssId) {
  const keyframeRegex = /@(-webkit-)?keyframes\s+(\S+)/gi;
  const animNames = new Set();
  let match;
  while ((match = keyframeRegex.exec(cssString))) {
    animNames.add(match[2]);
  }

  if (animNames.size > 0) {
    const sorted = [...animNames].sort((a, b) => b.length - a.length);
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const name of sorted) {
      cssString = cssString.replace(
        new RegExp(`(@(?:-webkit-)?keyframes\\s+)${esc(name)}`, "gi"),
        `$1${name}-${cssId}`
      );
      cssString = cssString.replace(
        new RegExp(`((?:animation|animation-name)\\s*:\\s*[^;{]*?)\\b${esc(name)}\\b`, "gi"),
        `$1${name}-${cssId}`
      );
    }
  }

  function findClosure(s, openIndex) {
    let depth = 0;
    for (let i = openIndex; i < s.length; i++) {
      const ch = s[i];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return i;
      }
    }
    return s.length - 1;
  }

  const scopeInnerAtRules = new Set(["@media", "@supports", "@container", "@layer"]);

  function processBlock(str) {
    str = str.replaceAll(":root", `.${cssId}`);

    let out = "";
    let i = 0;
    while (i < str.length) {
      const braceIndex = str.indexOf('{', i);
      if (braceIndex === -1) {
        out += str.slice(i);
        break;
      }
      const header = str.substring(i, braceIndex);
      const endBrace = findClosure(str, braceIndex);
      const inner = str.substring(braceIndex + 1, endBrace);

      if (header.trim().startsWith("@")) {
        const atKeyword = header.trim().split(/\s+/)[0].toLowerCase();
        if (scopeInnerAtRules.has(atKeyword)) {
          out += header + "{" + processBlock(inner) + "}";
        } else {
          out += header + "{" + inner + "}";
        }
      } else {
        const innerScoped = processBlock(inner);
        const selectors = header
          .split(",")
          .map(s => s.trim())
          .filter(Boolean);
        const scopedHeader = selectors.length > 0
          ? selectors.map(sel => scopeSelector(sel, cssId)).join(", ")
          : header;
        out += scopedHeader + "{" + innerScoped + "}";
      }

      i = endBrace + 1;
    }
    return out;
  }

  return processBlock(cssString);
}
