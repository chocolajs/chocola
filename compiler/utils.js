import { createHash } from "crypto";
import chalk from "./chalk.js";

export function throwError(err) {
  console.log(chalk.red.bold("Error!"), "A fatal error has occurred:\n");
  throw new Error(err);
}

export function warnConstantCondition(location, tag, attr, truthy) {
  const article = /^[aeiou]/.test(attr) ? "an" : "a";
  console.warn(
    chalk.bold.yellow("WARNING!"),
    `${location}: <${tag}> has ${article} \`${attr}\` condition that is always ${truthy ? "truthy" : "falsy"}`
  );
}

export function warnUnusedDeclaration(location, kind, name) {
  console.warn(
    chalk.bold.yellow("WARNING!"),
    `${location}: ${kind} \`${name}\` is never used`
  );
}

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

export function genRandomId(collection = null, length = 10, lettersOnly = false) {
  let id;
  if (lettersOnly) {
    id = Array.from({ length }, () => ID_LETTERS[Math.floor(Math.random() * ID_LETTERS.length)]).join("");
  } else {
    id = Math.random().toString(36).substring(2, length + 2);
  }
  if (!collection) return id;
  if (collection.includes(id)) {
    return genRandomId(collection, length, lettersOnly);
  } else {
    collection.push(id);
    return id;
  }
}

export function incrementAlfabet(letters) {
  let arr = letters.split("");
  let i = arr.length - 1;

  while (i >= 0) {
    let pos = arr[i].charCodeAt(0) - 97;
    if (pos < 25) {
      arr[i] = String.fromCharCode(pos + 97 + 1);
      return arr.join("");
    } else {
      arr[i] = "a";
      i--;
    }
  }

  return "a" + arr.join("");
}

export function deterministicHash(content, length = 8) {
  const hash = createHash("sha256").update(content).digest();
  let result = "";
  for (let i = 0; i < length; i++) {
    result += String.fromCharCode(97 + (hash[i % hash.length] % 26));
  }
  return result;
}

const ID_LETTERS = "abcdefghijklmnopqrstuvwxyz";
