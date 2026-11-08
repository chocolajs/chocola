import { parseHTML } from "linkedom";
import { restoreCurlyBraces } from "../utils.js";

/**
 * Create a detached render document. Rendering always starts from a fragment;
 * the document only exists so `linkedom` can create nodes and fragments.
 *
 * @returns {Document}
 */
export function createRenderDocument() {
  return parseHTML("<!doctype html><html><head></head><body></body></html>").document;
}

/**
 * Parse fragment HTML without wrapping it in a document body.
 *
 * @param {string} html
 * @param {Document} doc
 * @returns {DocumentFragment}
 */
export function parseFragment(html, doc) {
  const fragment = doc.createDocumentFragment();
  const temp = doc.createElement("div");
  temp.innerHTML = html;

  for (const child of [...temp.childNodes]) {
    fragment.appendChild(child);
  }

  return fragment;
}

/**
 * Serialize a fragment (not a whole document) and restore protected characters.
 *
 * `linkedom` serializes document fragments with a `<#document-fragment>` wrapper,
 * so a temporary element is used to obtain the inner HTML.
 *
 * @param {DocumentFragment} fragment
 * @param {Document} doc
 * @returns {string}
 */
export function serializeFragment(fragment, doc) {
  const holder = doc.createElement("div");
  holder.appendChild(fragment.cloneNode(true));
  return restoreCurlyBraces(holder.innerHTML);
}
