/**
 * Static tag classification and unknown-component suggestions.
 *
 * A tag in a `.chjs` template is valid when it is either:
 * - a known HTML/SVG/MathML element (see `KNOWN_HTML_TAGS`), or
 * - a hyphenated custom element (`<my-widget>`), or
 * - an imported `.chjs` component local / namespace tag (resolved by the graph).
 *
 * Anything else is an unknown component. `app` is intentionally not listed:
 * documents do not belong to core.
 */

export const KNOWN_HTML_TAGS = new Set([
  // HTML
  "a", "abbr", "address", "area", "article", "aside", "audio",
  "b", "base", "bdi", "bdo", "blockquote", "body", "br", "button",
  "canvas", "caption", "cite", "code", "col", "colgroup",
  "data", "datalist", "dd", "del", "details", "dfn", "dialog", "div", "dl", "dt",
  "em", "embed", "fieldset", "figcaption", "figure", "footer", "form",
  "h1", "h2", "h3", "h4", "h5", "h6", "head", "header", "hgroup", "hr", "html",
  "i", "iframe", "img", "input", "ins", "kbd", "label", "legend", "li", "link",
  "main", "map", "mark", "menu", "meta", "meter", "nav", "noscript",
  "object", "ol", "optgroup", "option", "output",
  "p", "param", "picture", "pre", "progress",
  "q", "rp", "rt", "ruby", "s", "samp", "script", "search", "section", "select",
  "slot", "small", "source", "span", "strong", "style", "sub", "summary", "sup",
  "table", "tbody", "td", "template", "textarea", "tfoot", "th", "thead", "time",
  "title", "tr", "track", "u", "ul", "var", "video", "wbr",

  // SVG
  "svg", "animate", "animatemotion", "animatetransform", "circle", "clippath",
  "defs", "desc", "ellipse", "feblend", "fecolormatrix", "fecomponenttransfer",
  "fecomposite", "feconvolvematrix", "fediffuselighting", "fedisplacementmap",
  "fedistantlight", "fedropshadow", "feflood", "fefunca", "fefuncb", "fefuncg",
  "fefuncr", "fegaussianblur", "feimage", "femerge", "femergenode",
  "femorphology", "feoffset", "fepointlight", "fespecularlighting", "fespotlight",
  "fetile", "feturbulence", "filter", "foreignobject", "g", "image", "line",
  "lineargradient", "marker", "mask", "metadata", "mpath", "path", "pattern",
  "polygon", "polyline", "radialgradient", "rect", "set", "stop", "switch",
  "symbol", "text", "textpath", "tspan", "use", "view",

  // MathML
  "math", "maction", "maligngroup", "malignmark", "menclose", "merror", "mfenced",
  "mfrac", "mglyph", "mi", "mlabeledtr", "mlongdiv", "mmultiscripts", "mn", "mo",
  "mover", "mpadded", "mphantom", "mprescripts", "mroot", "mrow", "ms",
  "mscarries", "mscarry", "msgroup", "msline", "mspace", "msqrt", "msrow",
  "mstack", "mstyle", "msub", "msubsup", "msup", "mtable", "mtd", "mtext", "mtr",
  "munder", "munderover", "semantics", "annotation", "annotation-xml",
]);

/**
 * @param {string} tagLower lowercase tag name
 * @returns {boolean} true when the tag needs no import
 */
export function isStaticTag(tagLower) {
  return KNOWN_HTML_TAGS.has(tagLower) || tagLower.includes("-");
}

/**
 * Levenshtein edit distance between two strings.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let previous = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) previous[j] = j;

  for (let i = 1; i <= a.length; i++) {
    const current = new Array(b.length + 1);
    current[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost
      );
    }
    previous = current;
  }

  return previous[b.length];
}

/**
 * Suggest the closest imported/namespace tag for an unknown component.
 *
 * Only capitalized source tags get suggestions, matching the RFC's guidance.
 * A candidate matches when it is equal case-insensitively, is a case-insensitive
 * prefix of the tag (or vice versa), or is within Levenshtein distance 2.
 *
 * @param {string} rawName source-cased tag name
 * @param {Iterable<string>} candidates import locals and namespace tags
 * @returns {string|null}
 */
export function suggestTag(rawName, candidates) {
  if (typeof rawName !== "string" || rawName.length === 0) return null;
  if (!/^[A-Z]$/.test(rawName[0])) return null;

  const lower = rawName.toLowerCase();
  let best = null;
  let bestScore = Infinity;

  for (const candidate of candidates || []) {
    const name = String(candidate);
    if (!name) continue;

    const candidateLower = name.toLowerCase();
    if (candidateLower === lower) continue;

    let score;
    if (candidateLower.startsWith(lower) || lower.startsWith(candidateLower)) {
      score = 1;
    } else {
      const distance = levenshtein(lower, candidateLower);
      if (distance > 2) continue;
      score = 2 + distance;
    }

    if (score < bestScore || (score === bestScore && (best === null || name < best))) {
      best = name;
      bestScore = score;
    }
  }

  return best;
}
