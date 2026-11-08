import { createHash } from "crypto";

export function throwError(err) {
  throw new Error(err);
}

export function warnConstantCondition() {}
export function warnUnusedDeclaration() {}

function normalizeAttributeQuotes(html) {
  return html
    .replace(/(\s[\w:.-]+)=(['"])([\s\S]*?)\2/g, '$1="$3"')
    .replace(/(\s[\w:.-]+)=([^\s"'<>=]+)/g, '$1="$2"');
}

function getStartTag(outerHTML) {
  let inQuote = null;
  for (let i = 0; i < outerHTML.length; i++) {
    const c = outerHTML[i];
    if (inQuote) {
      if (c === inQuote) inQuote = null;
    } else if (c === '"' || c === "'") {
      inQuote = c;
    } else if (c === ">") {
      return outerHTML.slice(0, i + 1);
    }
  }
  return outerHTML;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function flexibleStartTagRegex(startTag) {
  return new RegExp(
    startTag
      .split(/\s+/)
      .filter(Boolean)
      .map(escapeRegex)
      .join("\\s+")
  );
}

export function findElementLine(sourceContent, outerHTML) {
  const source = normalizeAttributeQuotes(sourceContent).toLowerCase().replace(/\/\s*>/g, ">");
  const startTags = [
    normalizeAttributeQuotes(getStartTag(outerHTML)),
    normalizeAttributeQuotes(
      getStartTag(
        outerHTML
          .replace(/&quot;/g, '"')
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
      )
    ),
  ].map(tag => tag.toLowerCase());
  const candidates = [
    flexibleStartTagRegex(startTags[0]),
    flexibleStartTagRegex(startTags[0].replace(/=""/g, "")),
    flexibleStartTagRegex(startTags[1]),
  ];
  for (const re of candidates) {
    const match = re.exec(source);
    if (match) {
      return source.substring(0, match.index).split("\n").length;
    }
  }
  return null;
}

export function deterministicHash(content, length = 8) {
  const hash = createHash("sha256").update(content).digest();
  let result = "";
  for (let i = 0; i < length; i++) {
    result += String.fromCharCode(97 + (hash[i % hash.length] % 26));
  }
  return result;
}

export function runtimeFunctionId(compName) {
  return "r_" + deterministicHash(compName, 8);
}
