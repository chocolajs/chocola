import path from "path";
import { scanTemplateTags } from "./module-source.js";
import { canonicalClassName, resolveModuleForTag } from "./component-context.js";
import { isChjsSource } from "./component-utils.js";

function hasModuleChunk(module, cx) {
  return Boolean(module?.template && cx.classNames.has(module.id));
}

function resolveImportedModule(module, imp, graph) {
  const sourcePath = path.resolve(path.dirname(module.sourcePath), imp.source);
  for (const candidate of graph.modules.values()) {
    if (candidate.sourcePath === sourcePath) return candidate;
  }
  return null;
}

/**
 * Build the metadata consumed by `generateRuntime()`.
 *
 * - one entry per module with a CSR class or `$runtime`;
 * - non-`.chjs` imports preserved verbatim;
 * - `.chjs` imports replaced by canonical class imports.
 */
export function buildModuleChunks(graph, cx) {
  const chunks = [];

  for (const id of [...graph.modules.keys()].sort()) {
    const module = graph.moduleById(id);
    const canonical = cx.classNames.get(id) || null;
    const classSource = canonical
      ? cx.csrClasses.get(`${id}#${canonical}`) || null
      : null;
    const runtimeSource = cx.runtimeFunctions.get(id) || null;

    if (!classSource && !runtimeSource) continue;

    const componentImports = [];
    const sideEffectImports = [];
    const seenImports = new Set();

    for (const imp of module.imports || []) {
      if (!isChjsSource(imp.source)) continue;

      const specifiers = imp.specifiers || [];
      if (specifiers.length === 0) {
        const child = resolveImportedModule(module, imp, graph);
        if (child && hasModuleChunk(child, cx)) {
          sideEffectImports.push(child.id);
        }
        continue;
      }

      for (const specifier of specifiers) {
        if (!specifier.local || specifier.type === "namespace") continue;
        const childId = module.importMap.get(specifier.local.toLowerCase());
        const child = childId ? graph.moduleById(childId) : null;
        if (!child || !hasModuleChunk(child, cx)) continue;

        const key = `${child.id}#${specifier.local}`;
        if (seenImports.has(key)) continue;
        seenImports.add(key);
        componentImports.push({
          childId: child.id,
          local: specifier.local,
          canonical: canonicalClassName(child),
        });
      }
    }

    if (module.template) {
      for (const tag of scanTemplateTags(module.template)) {
        if (!tag.lowerName.includes(":")) continue;
        const child = resolveModuleForTag(module, tag.lowerName, graph);
        if (!child || !hasModuleChunk(child, cx)) continue;

        const key = `${child.id}#`;
        if (seenImports.has(key)) continue;
        seenImports.add(key);
        componentImports.push({
          childId: child.id,
          local: null,
          canonical: canonicalClassName(child),
        });
      }
    }

    chunks.push({
      id,
      canonical,
      classSource,
      runtimeSource,
      imports: cx.usedImports.get(id) || [],
      componentImports,
      sideEffectImports,
    });
  }

  return chunks;
}
