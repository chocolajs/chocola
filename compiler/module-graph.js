import path from "path";
import { promises as fs } from "fs";
import { normalizeConfig } from "./config.js";
import { parseModuleSource, scanTemplateTags } from "./module-source.js";
import { isStaticTag, suggestTag } from "./tags.js";

const COMPONENT_EXTENSION = ".chjs";

function isChjsSource(source) {
  return typeof source === "string" && source.toLowerCase().endsWith(COMPONENT_EXTENSION);
}

function toModuleId(rootDir, sourcePath) {
  return path.relative(rootDir, sourcePath).split(path.sep).join("/");
}

function stripChjsExtension(relativePath) {
  return relativePath.replace(/\.chjs$/i, "");
}

export class ChocolaModule {
  constructor({ id, sourcePath, source, isRoot = false }) {
    this.id = id;
    this.sourcePath = sourcePath;
    this.isRoot = isRoot;
    this.source = source;
    this.script = null;
    this.template = null;
    this.templateStartLine = null;
    this.styles = null;
    this.imports = [];
    this.importMap = new Map();
    this.namespaceMap = new Map();
    this.deps = new Set();
    this.compProps = [];
    this.topFuncs = [];
    this.topVars = [];
    this.cssId = null;
    this.fnId = null;
  }
}

export class ModuleGraph {
  constructor(rootDir, config) {
    this.rootDir = rootDir;
    this.entry = null;
    this.config = config;
    this.root = null;
    this.modules = new Map();
  }

  addModule(module) {
    this.modules.set(module.id, module);
    return module;
  }

  moduleById(id) {
    return this.modules.get(id);
  }
}

async function readSource(sourcePath, message) {
  try {
    return await fs.readFile(sourcePath, "utf-8");
  } catch {
    throw new Error(message);
  }
}

async function loadDependency(graph, owner, sourcePath, displaySource, queue) {
  const id = toModuleId(graph.rootDir, sourcePath);
  const existing = graph.moduleById(id);
  if (existing) return existing;

  const source = await readSource(
    sourcePath,
    `Cannot resolve import "${displaySource}" from ${owner.id}`
  );
  const module = new ChocolaModule({ id, sourcePath, source, isRoot: false });
  graph.addModule(module);
  queue.push(module);
  return module;
}

async function listChjsFiles(dir) {
  const files = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listChjsFiles(fullPath)));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(COMPONENT_EXTENSION)) {
      files.push(fullPath);
    }
  }

  return files;
}

async function collectNamespace(dir, graph, owner, queue) {
  const components = new Map();
  const moduleIds = new Set();
  const files = await listChjsFiles(dir);

  for (const file of files) {
    const relPath = stripChjsExtension(
      path.relative(dir, file).split(path.sep).join("/")
    );
    const key = relPath.toLowerCase();
    const child = await loadDependency(graph, owner, file, relPath, queue);

    const existingId = components.get(key);
    if (existingId && existingId !== child.id) {
      throw new Error(
        `Ambiguous namespace component "${relPath}" in ${owner.id}: "${existingId}" and "${child.id}"`
      );
    }

    components.set(key, child.id);
    moduleIds.add(child.id);
    owner.deps.add(child.id);
  }

  return { components, moduleIds };
}

async function processImports(module, graph, queue) {
  const importLocalNames = new Map();
  const namespaceNames = new Map();

  for (const imp of module.imports) {
    const specifiers = imp.specifiers || [];

    if (isChjsSource(imp.source)) {
      if (specifiers.some((specifier) => specifier.type === "namespace")) {
        throw new Error(`Namespace import "${imp.source}" must point to a directory`);
      }

      const sourcePath = path.resolve(path.dirname(module.sourcePath), imp.source);
      const child = await loadDependency(graph, module, sourcePath, imp.source, queue);
      module.deps.add(child.id);

      for (const specifier of specifiers) {
        if (specifier.type !== "default" && specifier.type !== "named") continue;
        if (!specifier.local) continue;
        const local = specifier.local.toLowerCase();
        module.importMap.set(local, child.id);
        importLocalNames.set(local, specifier.local);
      }
      continue;
    }

    const namespaceSpecifiers = specifiers.filter(
      (specifier) => specifier.type === "namespace"
    );
    if (namespaceSpecifiers.length === 0) continue;

    const namespaceDir = path.resolve(path.dirname(module.sourcePath), imp.source);
    let stat = null;
    try {
      stat = await fs.stat(namespaceDir);
    } catch {
      stat = null;
    }

    if (!stat || !stat.isDirectory()) {
      // A trailing slash makes the directory intent explicit; a namespace import
      // of a regular JS module stays a host concern and is preserved verbatim.
      if (imp.source.endsWith("/") || imp.source.endsWith(path.sep)) {
        throw new Error(`Namespace import "${imp.source}" must point to a directory`);
      }
      continue;
    }

    for (const specifier of namespaceSpecifiers) {
      if (!specifier.local) continue;
      const local = specifier.local.toLowerCase();
      const existing = namespaceNames.get(local);

      if (existing) {
        if (existing.dir !== namespaceDir) {
          throw new Error(
            `Namespace prefix <${specifier.local}> is imported from both "${existing.source}" and "${imp.source}" in ${module.id}`
          );
        }
        continue;
      }

      const { components, moduleIds } = await collectNamespace(
        namespaceDir,
        graph,
        module,
        queue
      );
      module.namespaceMap.set(local, { dir: namespaceDir, components, moduleIds });
      namespaceNames.set(local, {
        dir: namespaceDir,
        source: imp.source,
        local: specifier.local,
      });
    }
  }

  for (const [local, namespace] of namespaceNames) {
    if (importLocalNames.has(local)) {
      throw new Error(
        `Namespace prefix <${namespace.local}> collides with import <${importLocalNames.get(local)}> in ${module.id}`
      );
    }
  }
}

function namespaceSuggestionCandidates(module, graph) {
  const candidates = [];

  for (const imp of module.imports) {
    if (!isChjsSource(imp.source)) continue;
    for (const specifier of imp.specifiers || []) {
      if (specifier.type !== "default" && specifier.type !== "named") continue;
      if (specifier.local) candidates.push(specifier.local);
    }
  }

  for (const [prefixLower, namespace] of module.namespaceMap) {
    let prefix = prefixLower;
    for (const imp of module.imports) {
      const match = (imp.specifiers || []).find(
        (specifier) =>
          specifier.type === "namespace" &&
          specifier.local &&
          specifier.local.toLowerCase() === prefixLower
      );
      if (match) {
        prefix = match.local;
        break;
      }
    }

    for (const moduleId of namespace.moduleIds) {
      const child = graph.moduleById(moduleId);
      if (!child) continue;
      const relPath = stripChjsExtension(
        path.relative(namespace.dir, child.sourcePath).split(path.sep).join("/")
      );
      candidates.push(`${prefix}:${relPath}`);
    }
  }

  return candidates;
}

function unknownComponentError(module, tag, graph) {
  let message = `Unknown component <${tag.rawName}> in ${module.id}:${tag.line}. Did you forget to import it?`;
  const suggestion = suggestTag(tag.rawName, namespaceSuggestionCandidates(module, graph));
  if (suggestion) message += ` Did you mean <${suggestion}>?`;
  return new Error(message);
}

function processTemplateTags(module, graph) {
  if (!module.template) return;

  const lineOffset = (module.templateStartLine || 1) - 1;
  for (const tag of scanTemplateTags(module.template, { lineOffset })) {
    const childId = module.importMap.get(tag.lowerName);
    if (childId) {
      module.deps.add(childId);
      continue;
    }

    if (tag.lowerName.includes(":")) {
      const [prefix, ...rest] = tag.lowerName.split(":");
      const namespace = module.namespaceMap.get(prefix);
      if (namespace) {
        const namespaceId = namespace.components.get(rest.join("/"));
        if (namespaceId) {
          module.deps.add(namespaceId);
          continue;
        }
        throw unknownComponentError(module, tag, graph);
      }
    }

    if (isStaticTag(tag.lowerName)) continue;

    throw unknownComponentError(module, tag, graph);
  }
}

/**
 * Build an import-only module graph for a `.chjs` root component.
 *
 * @param {string} rootDir absolute project root
 * @param {{entry?: string, config?: object}} [options]
 * @returns {Promise<ModuleGraph>}
 */
export async function buildModuleGraph(rootDir, options = {}) {
  if (typeof rootDir !== "string" || !path.isAbsolute(rootDir)) {
    throw new Error(`rootDir must be an absolute path (received "${rootDir}")`);
  }

  const { entry, config } = options || {};
  if (typeof entry !== "string" || entry.length === 0) {
    throw new Error('entry is required; pass { entry: "<path to root .chjs>" }');
  }

  if (!entry.toLowerCase().endsWith(COMPONENT_EXTENSION)) {
    throw new Error(`entry must point to a .chjs component (received "${entry}")`);
  }

  const rootPath = path.resolve(rootDir, entry);
  const rootSource = await readSource(rootPath, `Cannot read entry "${entry}"`);

  const graph = new ModuleGraph(rootDir, normalizeConfig(config));
  const root = new ChocolaModule({
    id: toModuleId(rootDir, rootPath),
    sourcePath: rootPath,
    source: rootSource,
    isRoot: true,
  });

  graph.addModule(root);
  graph.root = root;
  graph.entry = root.id;

  const queue = [root];
  while (queue.length > 0) {
    const module = queue.shift();
    parseModuleSource(module);
    await processImports(module, graph, queue);
    processTemplateTags(module, graph);
  }

  return graph;
}
