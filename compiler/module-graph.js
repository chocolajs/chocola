import path from "path";
import { promises as fs } from "fs";
import { parseHTML } from "linkedom";
import chalk from "./chalk.js";
import { loadConfig, resolvePaths } from "./config.js";
import { getComponents, getSrcIndex } from "./pipeline.js";
import { protectCurlyBraces } from "../utils.js";
import { deterministicHash, runtimeFunctionId } from "./utils.js";
import { createDOM, getAssetLinks, getScriptElements } from "./dom-processor.js";
import {
  extractPropsDefaults, extractTopLevelFunctions, extractTopLevelVariables,
} from "../parser/index.js";

const RUNTIME_KW = "$runtime";
const PAGE_ID = "index.html";

export class ChocolaModule {
  constructor({ id, kind, sourcePath, source, mtimeMs }) {
    this.id = id;
    this.kind = kind;
    this.sourcePath = sourcePath;
    this.source = source;
    this.mtimeMs = mtimeMs;
    this.compName = kind === "component" ? path.basename(id) : null;
    this.deps = new Set();
    this.parsed = false;
    this.script = null;
    this.template = null;
    this.styles = null;
    this.compProps = [];
    this.topFuncs = [];
    this.topVars = [];
    this.imports = [];
    this.cssId = null;
    this.fnId = null;
  }
}

export class ModuleGraph {
  constructor(rootDir, config, paths) {
    this.rootDir = rootDir;
    this.config = config;
    this.paths = paths;
    this.modules = new Map();
    this.components = new Map();
    this.loadedComponents = new Map();
    this.page = null;
  }

  addModule(module) {
    this.modules.set(module.id, module);
    if (module.kind === "component") {
      this.components.set(module.compName, module);
      this.loadedComponents.set(module.compName, module.source);
    }
  }

  component(compName) {
    return this.components.get(compName);
  }

  moduleById(id) {
    return this.modules.get(id);
  }
}

async function getFileMtime(filePath) {
  try {
    return (await fs.stat(filePath)).mtimeMs;
  } catch {
    return null;
  }
}

function isExternalUrl(url) {
  return url.startsWith("http://") || url.startsWith("https://");
}

function compileComponentModule(module, graph) {
  if (module.parsed) return module;

  const dom = parseHTML(protectCurlyBraces(module.source));
  const doc = dom.document;
  module.script = doc.querySelector("script")?.innerHTML ?? null;
  module.template = doc.querySelector("template")?.innerHTML ?? null;
  module.styles = doc.querySelector("style")?.innerHTML ?? null;
  module.compProps = extractPropsDefaults(module.script);
  module.topFuncs = extractTopLevelFunctions(module.script || "", RUNTIME_KW);
  module.topVars = extractTopLevelVariables(module.script || "");
  module.cssId = deterministicHash(module.compName, 8);
  module.fnId = runtimeFunctionId(module.compName);

  const deps = new Set();
  if (module.script) {
    const importRegex = /import\s+(\w+)\s+from\s+['"]([^'"]+)['"]\s*;?\s*/g;
    let match;
    while ((match = importRegex.exec(module.script)) !== null) {
      const importedCompName = path.basename(match[2]).toLowerCase();
      const importedModule = graph.component(importedCompName);
      if (importedModule) deps.add(importedModule.id);
    }
  }
  if (module.template) {
    const frag = parseHTML(module.template).document;
    for (const el of frag.querySelectorAll("*")) {
      const childModule = graph.component(el.tagName.toLowerCase() + ".html");
      if (childModule) deps.add(childModule.id);
    }
  }
  module.deps = deps;
  module.parsed = true;
  return module;
}

function scanComponentDeps(root, graph) {
  const deps = new Set();
  for (const el of root.querySelectorAll("*")) {
    const childModule = graph.component(el.tagName.toLowerCase() + ".html");
    if (childModule) deps.add(childModule.id);
  }
  return deps;
}

function scanAssetModules(doc, graph) {
  const deps = new Set();
  const { stylesheets, icons } = getAssetLinks(doc);
  const scripts = getScriptElements(doc);

  const collect = (href) => {
    if (isExternalUrl(href)) return;
    const id = href.split("\\").join("/");
    const existing = graph.moduleById(id);
    if (existing) {
      deps.add(id);
      return;
    }
    const asset = new ChocolaModule({
      id,
      kind: "asset",
      sourcePath: path.join(graph.paths.src, href),
      source: null,
      mtimeMs: null,
    });
    graph.addModule(asset);
    deps.add(id);
  };

  for (const link of stylesheets) collect(link.href);
  for (const link of icons) collect(link.href);
  for (const script of scripts) collect(script.getAttribute("src"));

  return deps;
}

export async function buildModuleGraph(rootDir) {
  const config = await loadConfig(rootDir);
  const paths = resolvePaths(rootDir, config);

  const graph = new ModuleGraph(rootDir, config, paths);

  const indexFiles = await getSrcIndex(paths.src);
  const pageModule = new ChocolaModule({
    id: PAGE_ID,
    kind: "page",
    sourcePath: indexFiles.srcPath,
    source: indexFiles.srcHtmlFile,
    mtimeMs: await getFileMtime(indexFiles.srcPath),
  });
  graph.addModule(pageModule);
  graph.page = pageModule;

  const foundComponents = await getComponents(paths.components);
  const { loadedComponents, componentsLib, emptyComps } = foundComponents;

  console.log(chalk.bold.green(">"), "Components found in", chalk.green.underline(paths.components) + ":");
  console.log("   ", componentsLib, "\n\n");

  if (emptyComps?.length > 0) {
    console.warn(chalk.bold.yellow("WARNING!"), "The following component files are empty:");
    console.log("   ", emptyComps);
  }

  for (const filename of componentsLib) {
    const compName = filename.toLowerCase();
    const source = loadedComponents.get(compName);
    if (source === undefined) continue;
    const id = path.posix.join(config.libDir, compName);
    const module = new ChocolaModule({
      id,
      kind: "component",
      sourcePath: path.join(paths.components, filename),
      source,
      mtimeMs: await getFileMtime(path.join(paths.components, filename)),
    });
    graph.addModule(module);
    compileComponentModule(module, graph);
  }

  const pageDom = createDOM(pageModule.source);
  const pageDeps = scanComponentDeps(pageDom.document, graph);
  for (const dep of scanAssetModules(pageDom.document, graph)) {
    pageDeps.add(dep);
  }
  pageModule.deps = pageDeps;

  return graph;
}
