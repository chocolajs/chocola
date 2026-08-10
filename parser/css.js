function hasCombinator(sel) {
  let depth = 0;
  for (const ch of sel) {
    if (ch === '[') depth++;
    else if (ch === ']') depth--;
    else if (depth === 0 && (ch === ' ' || ch === '>' || ch === '+' || ch === '~')) return true;
  }
  return false;
}

function scopeSelector(sel, cssId) {
  const s = sel.trim();
  if (s.startsWith("." + cssId)) return s;
  if (hasCombinator(s)) return `.${cssId} ${s}`;
  return `.${cssId}${s}, .${cssId} ${s}`;
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
