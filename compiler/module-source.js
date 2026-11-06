import { protectCurlyBraces, restoreCurlyBraces } from "../utils.js";
import {
  extractPropsDefaults,
  extractTopLevelFunctions,
  extractTopLevelVariables,
  parseScript,
} from "../parser/index.js";
import { deterministicHash, runtimeFunctionId } from "./utils.js";


const SECTION_KEYS = {
  script: "script",
  template: "template",
  style: "styles",
};

const MODULE_FILE_RE = /\.(?:m?[jt]sx?|c?js|json|css|wasm)$/i;
const CHJS_EXTENSION = ".chjs";

/**
 * Read the start/end tag beginning at `index` without HTML-parsing it.
 *
 * @param {string} source
 * @param {number} index index of `<`
 */
function readTag(source, index) {
  if (source.startsWith("<!--", index)) {
    const close = source.indexOf("-->", index + 4);
    return { type: "comment", end: close === -1 ? source.length : close + 3 };
  }

  if (source[index + 1] === "!" || source[index + 1] === "?") {
    return { type: "other", end: findTagEnd(source, index + 2) };
  }

  const isClosing = source[index + 1] === "/";
  let cursor = index + (isClosing ? 2 : 1);
  const nameStart = cursor;
  while (cursor < source.length && !/[\s/>]/.test(source[cursor])) cursor++;

  const rawName = source.slice(nameStart, cursor);
  if (!rawName) return { type: "other", end: index + 1 };

  const end = findTagEnd(source, cursor);
  const terminated = source[end - 1] === ">";
  const contentEnd = terminated ? end - 1 : end;
  const selfClosing =
    !isClosing && terminated && /\/\s*$/.test(source.slice(cursor, contentEnd));

  return {
    type: isClosing ? "end" : "start",
    rawName,
    lowerName: rawName.toLowerCase(),
    selfClosing,
    end,
  };
}

/**
 * Find the `>` that closes the tag at `start`, ignoring quoted attribute values.
 * @param {string} source
 * @param {number} start
 * @returns {number} index just after `>`, or `source.length`
 */
function findTagEnd(source, start) {
  let quote = null;
  for (let i = start; i < source.length; i++) {
    const char = source[i];
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ">") {
      return i + 1;
    }
  }
  return source.length;
}

/**
 * Find the closing tag matching a block opened at `from`.
 * Nested `<template>` blocks are depth-tracked so the outer template is not
 * truncated at the first nested `</template>`.
 *
 * @param {string} source
 * @param {number} from
 * @param {string} lowerName
 * @returns {{contentEnd:number,end:number}|null}
 */
function findBlockClose(source, from, lowerName) {
  let depth = 0;
  let i = from;

  while (i < source.length) {
    const lt = source.indexOf("<", i);
    if (lt === -1) return null;

    const tag = readTag(source, lt);

    // A script/style block nested in a template may contain markup-like strings;
    // skip its contents so `"</template>"` in JavaScript cannot truncate the outer block.
    if (
      lowerName === "template" &&
      tag.type === "start" &&
      (tag.lowerName === "script" || tag.lowerName === "style") &&
      !tag.selfClosing
    ) {
      const close = findBlockClose(source, tag.end, tag.lowerName);
      i = close ? close.end : source.length;
      continue;
    }

    if (tag.type === "start" && tag.lowerName === lowerName && !tag.selfClosing) {
      if (lowerName === "template") depth++;
    } else if (tag.type === "end" && tag.lowerName === lowerName) {
      if (depth === 0) return { contentEnd: lt, end: tag.end };
      depth--;
    }
    i = tag.end;
  }

  return null;
}

/**
 * Split a `.chjs` source into raw section contents.
 *
 * Returns the first `<script>`, `<template>`, and `<style>` block of each kind.
 * Contents are returned verbatim (no HTML parsing or rewriting).
 *
 * @param {string} source
 * @returns {{script:string|null,template:string|null,styles:string|null}}
 */
export function splitComponentSource(source) {
  const result = { script: null, template: null, styles: null };
  if (typeof source !== "string" || source.length === 0) return result;

  let i = 0;
  while (i < source.length) {
    const lt = source.indexOf("<", i);
    if (lt === -1) break;

    const tag = readTag(source, lt);
    if (tag.type !== "start") {
      i = tag.end;
      continue;
    }

    const key = SECTION_KEYS[tag.lowerName];
    if (!key) {
      i = tag.end;
      continue;
    }

    if (tag.selfClosing) {
      if (result[key] === null) result[key] = "";
      i = tag.end;
      continue;
    }

    const close = findBlockClose(source, tag.end, tag.lowerName);
    if (!close) {
      if (result[key] === null) result[key] = source.slice(tag.end);
      break;
    }

    if (result[key] === null) result[key] = source.slice(tag.end, close.contentEnd);
    i = close.end;
  }

  return result;
}

function toLowerSet(values) {
  if (values instanceof Set) return values;
  const set = new Set();
  for (const value of values || []) set.add(String(value).toLowerCase());
  return set;
}

function isChjsSource(source) {
  return typeof source === "string" && source.toLowerCase().endsWith(CHJS_EXTENSION);
}

function isModuleFileSource(source) {
  return MODULE_FILE_RE.test(source);
}

/**
 * Rewrite self-closing component, namespace, and `slot` tags into explicit pairs.
 *
 * Only tags matching an imported `.chjs` local, a namespace prefix, or `slot`
 * are rewritten. Static void elements, hyphenated custom elements, comments,
 * script/style regions, and attribute values are left untouched.
 *
 * @param {string} templateSource
 * @param {{importLocals?: Iterable<string>, namespacePrefixes?: Iterable<string>}} options
 * @returns {string}
 */
export function expandSelfClosingComponents(templateSource, options = {}) {
  if (typeof templateSource !== "string" || templateSource.length === 0) {
    return templateSource;
  }

  const importLocals = toLowerSet(options.importLocals);
  const namespacePrefixes = toLowerSet(options.namespacePrefixes);
  const protectedSource = protectCurlyBraces(templateSource);

  let output = "";
  let copiedUntil = 0;
  let i = 0;

  while (i < protectedSource.length) {
    const lt = protectedSource.indexOf("<", i);
    if (lt === -1) break;

    const tag = readTag(protectedSource, lt);
    if (tag.type !== "start") {
      i = tag.end;
      continue;
    }

    const isBlock = tag.lowerName === "script" || tag.lowerName === "style";
    if (isBlock && !tag.selfClosing) {
      const close = findBlockClose(protectedSource, tag.end, tag.lowerName);
      i = close ? close.end : protectedSource.length;
      continue;
    }

    if (!tag.selfClosing) {
      i = tag.end;
      continue;
    }

    const colon = tag.lowerName.indexOf(":");
    const shouldExpand =
      tag.lowerName === "slot" ||
      importLocals.has(tag.lowerName) ||
      (colon !== -1 && namespacePrefixes.has(tag.lowerName.slice(0, colon)));

    if (!shouldExpand) {
      i = tag.end;
      continue;
    }

    const tagText = protectedSource.slice(lt, tag.end);
    const expanded = tagText.replace(/\s*\/\s*>$/, ">") + `</${tag.rawName}>`;
    output += protectedSource.slice(copiedUntil, lt) + expanded;
    copiedUntil = tag.end;
    i = tag.end;
  }

  if (copiedUntil === 0) return restoreCurlyBraces(protectedSource);

  output += protectedSource.slice(copiedUntil);
  return restoreCurlyBraces(output);
}

function skipString(source, start) {
  const quote = source[start];
  for (let i = start + 1; i < source.length; i++) {
    const char = source[i];
    if (char === "\\") {
      i++;
      continue;
    }
    if (char === quote) return i;
  }
  return source.length - 1;
}

function skipInterpolation(source, start) {
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    const char = source[i];
    if (char === '"' || char === "'" || char === "`") {
      i = skipString(source, i);
      continue;
    }
    if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return source.length;
}

/**
 * Scan a raw template for start tags, preserving source casing and line numbers.
 *
 * Closing tags, comments, doctype/declarations, attribute values, curly-brace
 * interpolations, and script/style regions are skipped.
 *
 * @param {string} templateSource
 * @returns {Array<{rawName:string, lowerName:string, index:number, line:number}>}
 */
export function scanTemplateTags(templateSource) {
  const tags = [];
  if (typeof templateSource !== "string" || templateSource.length === 0) return tags;

  let i = 0;
  let lineCursor = 0;
  let line = 1;

  const lineAt = (index) => {
    for (; lineCursor < index; lineCursor++) {
      if (templateSource[lineCursor] === "\n") line++;
    }
    return line;
  };

  while (i < templateSource.length) {
    const char = templateSource[i];

    if (char === "{") {
      i = skipInterpolation(templateSource, i);
      continue;
    }

    if (char !== "<") {
      i++;
      continue;
    }

    const tag = readTag(templateSource, i);
    if (tag.type === "start") {
      const isBlock = tag.lowerName === "script" || tag.lowerName === "style";
      if (isBlock) {
        if (tag.selfClosing) {
          i = tag.end;
        } else {
          const close = findBlockClose(templateSource, tag.end, tag.lowerName);
          i = close ? close.end : templateSource.length;
        }
        continue;
      }

      tags.push({
        rawName: tag.rawName,
        lowerName: tag.lowerName,
        index: i,
        line: lineAt(i),
      });
    }

    i = tag.end > i ? tag.end : i + 1;
  }

  return tags;
}

function parseFallbackSpecifiers(text) {
  const specifiers = [];

  const withoutBraces = text.replace(/\{[\s\S]*\}/, " ");
  const withoutNamespace = withoutBraces.replace(/\*\s+as\s+[A-Za-z_$][\w$]*/, " ");
  const defaultMatch = withoutNamespace.trim().match(/^([A-Za-z_$][\w$]*)/);
  if (defaultMatch) specifiers.push({ type: "default", local: defaultMatch[1] });

  const namespaceMatch = text.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
  if (namespaceMatch) specifiers.push({ type: "namespace", local: namespaceMatch[1] });

  const braceMatch = text.match(/\{([\s\S]*)\}/);
  if (braceMatch) {
    for (const part of braceMatch[1].split(",")) {
      const cleaned = part.trim();
      if (!cleaned) continue;
      const match = cleaned.match(
        /^(?:type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/
      );
      if (!match) continue;
      specifiers.push({
        type: "named",
        imported: match[1],
        local: match[2] || match[1],
      });
    }
  }

  return specifiers;
}

/**
 * Conservative import-only fallback for scripts that Acorn cannot parse.
 *
 * Graph building must still see imports so a syntax error can be reported by
 * the host's bundler instead of silently dropping dependency edges.
 *
 * @param {string} script
 * @returns {Array<{source:string, specifiers:Array<object>, raw:string, start:number, end:number}>}
 */
export function scanImportsFallback(script) {
  if (typeof script !== "string" || script.length === 0) return [];

  const imports = [];
  const fromImport = /\bimport\s+([^;"']*?)\s*from\s*["']([^"']+)["']/g;
  const sideEffectImport = /\bimport\s*["']([^"']+)["']/g;

  let match;
  while ((match = fromImport.exec(script)) !== null) {
    imports.push({
      source: match[2],
      specifiers: parseFallbackSpecifiers(match[1]),
      raw: script.slice(match.index, fromImport.lastIndex),
      start: match.index,
      end: fromImport.lastIndex,
    });
  }

  while ((match = sideEffectImport.exec(script)) !== null) {
    imports.push({
      source: match[1],
      specifiers: [],
      raw: script.slice(match.index, sideEffectImport.lastIndex),
      start: match.index,
      end: sideEffectImport.lastIndex,
    });
  }

  imports.sort((a, b) => a.start - b.start);

  const deduped = [];
  for (const entry of imports) {
    if (!deduped.some((existing) => entry.start < existing.end && existing.start < entry.end)) {
      deduped.push(entry);
    }
  }

  return deduped;
}

/**
 * Collect template tag bindings from parsed imports.
 *
 * Default/named imports of `.chjs` files become tag locals. Namespace imports
 * that do not point at a module file are treated as namespace prefixes.
 *
 * @param {Array<{source:string, specifiers:Array<object>}>} imports
 */
function collectTemplateBindings(imports) {
  const importLocals = new Set();
  const namespacePrefixes = new Set();

  for (const imp of imports) {
    const componentImport = isChjsSource(imp.source);
    for (const specifier of imp.specifiers || []) {
      if (!specifier.local) continue;
      const local = specifier.local.toLowerCase();

      if (specifier.type === "namespace") {
        if (!componentImport && !isModuleFileSource(imp.source)) {
          namespacePrefixes.add(local);
        }
      } else if (componentImport) {
        importLocals.add(local);
      }
    }
  }

  return { importLocals, namespacePrefixes };
}

/**
 * Parse a module's raw source into the fields consumed by the graph and renderer.
 *
 * Pipeline: split raw sections -> parse script imports -> normalize self-closing
 * component tags -> store scripts/templates/styles -> compute hashes/declarations.
 *
 * @template {{ id:string, source:string, script?:any, template?:any, styles?:any,
 *   imports?:any, compProps?:any, topFuncs?:any, topVars?:any, cssId?:any, fnId?:any }} T
 * @param {T} module
 * @returns {T}
 */
export function parseModuleSource(module) {
  const source = typeof module?.source === "string" ? module.source : "";
  const sections = splitComponentSource(source);
  const parsed = parseScript(sections.script);

  const imports =
    sections.script && (parsed.ast === null || parsed.parseError)
      ? scanImportsFallback(sections.script)
      : parsed.imports;

  const { importLocals, namespacePrefixes } = collectTemplateBindings(imports);

  module.script = sections.script;
  module.template =
    sections.template === null
      ? null
      : expandSelfClosingComponents(sections.template, { importLocals, namespacePrefixes });
  module.styles = sections.styles;
  module.imports = imports;
  module.compProps = extractPropsDefaults(sections.script);
  module.topFuncs = extractTopLevelFunctions(sections.script || "", "$runtime");
  module.topVars = extractTopLevelVariables(sections.script || "");
  module.cssId = deterministicHash(module.id, 8);
  module.fnId = runtimeFunctionId(module.id);

  return module;
}
