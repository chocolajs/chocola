import { parseHTML } from "linkedom";
import { promises as fs } from "fs";
import path from "path";
import { protectCurlyBraces, restoreCurlyBraces } from "../utils.js";
import { throwError } from "./utils.js";
import { readMyFile } from "./fs.js";

export function createDOM(srcIndexContent) {
  const protectedContent = protectCurlyBraces(srcIndexContent);
  const dom = parseHTML(protectedContent);
  dom.protectedContent = protectedContent;
  return dom;
}

export function validateAppContainer(doc) {
  const appContainer = doc.querySelector("app");
  if (!appContainer) {
    throwError("Index page must have an <app> element");
  }
  return appContainer;
}

export function getAppElements(appContainer) {
  return Array.from(appContainer.querySelectorAll("*"));
}

export async function serializeDOM(dom) {
  return restoreCurlyBraces(dom.document.toString());
}

export async function writeHTMLOutput(html, outDirPath) {
  await fs.writeFile(path.join(outDirPath, "index.html"), html);
}

export function getAssetLinks(doc) {
  const docLinks = Array.from(doc.querySelectorAll("link"));
  const stylesheets = docLinks.filter(link => link.rel === "stylesheet");
  const icons = docLinks.filter(link => link.rel === "icon");
  return { stylesheets, icons };
}

export async function writeCSSOutput(css, outDirPath, filename = "scopes.css") {
  await fs.writeFile(path.join(outDirPath, filename), css);
}

export function appendStylesheetLink(doc, filename) {
  const linkEl = doc.createElement("link");
  linkEl.rel = "stylesheet";
  linkEl.href = "./" + filename;
  doc.head.appendChild(linkEl);
}

export function getScriptElements(doc) {
  return Array.from(doc.querySelectorAll("script[src]"));
}

export function appendRuntimeScript(doc, filename) {
  const runtimeScriptEl = doc.createElement("script");
  runtimeScriptEl.src = "./" + filename;
  doc.body.appendChild(runtimeScriptEl);
}
