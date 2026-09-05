import path from "path";
import { promises as fs } from "fs";
import {
  createDOM,
  validateAppContainer,
  getAppElements,
  getAssetLinks,
  getScriptElements,
  appendRuntimeScript,
  appendStylesheetLink,
  serializeDOM,
} from "./dom-processor.js";
import { processAllComponents } from "./component-processor.js";
import { generateRuntimeScript } from "./runtime-generator.js";
import { deterministicHash, throwError, warnConstantCondition, findElementLine } from "./utils.js";
import { compileExpr, evaluateConstant, hasMountIf, getMountIf, removeMountIf } from "../parser/index.js";
import {
  processStylesheet,
  processIcons,
  processScript,
  copyStaticDir,
} from "./pipeline.js";

function processPageConditionals(parent, sourceFile, sourceContent, ctx = {}) {
  const ctxProxy = new Proxy(ctx, {
    has() { return true; },
    get(target, key) { return target[key]; },
  });
  const children = [...parent.children];
  let chainActive = false;
  let chainRendered = false;

  const getLocation = (child) => {
    if (!sourceContent) return sourceFile;
    const lineNum = findElementLine(sourceContent, child.outerHTML);
    return lineNum !== null ? `${sourceFile}:${lineNum}` : sourceFile;
  };

  const warnIfConstant = (expr, child, attr) => {
    const { constant, value } = evaluateConstant(expr);
    if (!constant) return;
    warnConstantCondition(getLocation(child), child.tagName.toLowerCase(), attr, Boolean(value));
  };

  for (const child of children) {
    const hasIf = child.hasAttribute("if");
    const hasDelIf = hasMountIf(child);
    const hasElif = child.hasAttribute("elif");
    const hasElse = child.hasAttribute("else");

    if (hasIf || hasDelIf || hasElif) {
      const stripBraces = (raw) => raw.startsWith("{") ? raw.slice(1, -1) : raw;
      if (hasIf) warnIfConstant(stripBraces(child.getAttribute("if")), child, "if");
      if (hasDelIf) warnIfConstant(stripBraces(getMountIf(child)), child, "mount:if");
      if (hasElif) warnIfConstant(stripBraces(child.getAttribute("elif")), child, "elif");
    }

    if (hasElif || hasElse) {
      if (!chainActive) {
        const tag = child.tagName.toLowerCase();
        const attr = hasElif ? "elif" : "else";
        throwError(`${getLocation(child)}\n    <${tag}> has ${attr} without a preceding if/mount:if sibling`);
      }
      if (chainRendered) { child.remove(); continue; }
    }

    if (hasIf) {
      const raw = child.getAttribute("if");
      const expr = raw.startsWith("{") ? raw.slice(1, -1) : raw;
      const fn = compileExpr(expr, true);
      const result = fn(ctxProxy);
      chainActive = true;
      if (result) {
        chainRendered = true;
      } else {
        child.style.display = "none";
        chainRendered = false;
      }
      child.removeAttribute("if");
    } else if (hasDelIf) {
      const raw = getMountIf(child);
      const expr = raw.startsWith("{") ? raw.slice(1, -1) : raw;
      const fn = compileExpr(expr, true);
      const result = fn(ctxProxy);
      chainActive = true;
      if (result) {
        chainRendered = true;
      } else {
        child.remove();
        chainRendered = false;
      }
      removeMountIf(child);
    } else if (hasElif) {
      const raw = child.getAttribute("elif");
      const expr = raw.startsWith("{") ? raw.slice(1, -1) : raw;
      const fn = compileExpr(expr, true);
      const result = fn(ctxProxy);
      if (result) {
        chainRendered = true;
      } else {
        child.remove();
      }
      child.removeAttribute("elif");
    } else if (hasElse) {
      chainRendered = true;
      chainActive = false;
      child.removeAttribute("else");
    } else {
      chainActive = false;
      chainRendered = false;
    }

    if (child.parentNode) {
      processPageConditionals(child, sourceFile, sourceContent, ctx);
    }
  }
}

async function processAssets(doc, graph, out) {
  const { stylesheets, icons } = getAssetLinks(doc);
  const scripts = getScriptElements(doc);

  for (const link of stylesheets) {
    await processStylesheet(link, graph.rootDir, graph.config.srcDir, out);
  }

  for (const link of icons) {
    await processIcons(link, graph.rootDir, graph.config.srcDir, out);
  }

  for (const script of scripts) {
    await processScript(doc, script, graph.rootDir, graph.config.srcDir, out);
  }
}

export async function renderPage(graph, ctx = {}) {
  const out = {
    files: [],
    copies: [],
    ids: [],
    outDir: graph.paths.outDir,
  };

  const page = graph.page;
  const dom = createDOM(page.source);
  const doc = dom.document;
  const appContainer = validateAppContainer(doc);

  processPageConditionals(appContainer, page.sourcePath, dom.protectedContent, ctx);

  const appElements = getAppElements(appContainer);
  const { runtimeScript, scopesCss, hashMap, csrClasses } = processAllComponents(
    appElements,
    graph.loadedComponents,
    page.sourcePath,
    page.source,
    ctx
  );

  const csrSource = await fs.readFile(new URL("../runtime/index.js", import.meta.url), "utf-8");
  const runtimeFiles = generateRuntimeScript(runtimeScript, csrSource, csrClasses);

  await processAssets(doc, graph, out);

  if (scopesCss) {
    const fileName = "sc-" + deterministicHash(scopesCss, 6) + ".css";
    out.files.push({ path: fileName, content: scopesCss });
    appendStylesheetLink(doc, fileName);
  }

  for (const file of runtimeFiles) {
    out.files.push(file);
    appendRuntimeScript(doc, file.path);
  }

  const html = await serializeDOM(dom);

  await copyStaticDir(graph.paths.src, out);

  return { html, hashMap, files: out.files, copies: out.copies };
}
