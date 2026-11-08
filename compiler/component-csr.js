import { protectCurlyBraces } from "../utils.js";
import { scopeCss } from "../parser/index.js";
import { parseFragment } from "./dom-processor.js";
import { canonicalClassName, resolveModuleForTag } from "./component-context.js";
import { isChjsSource, tagDescendants } from "./component-utils.js";
import { buildRuntimeSource } from "./component-runtime.js";

function escapeForTemplateLiteral(str) {
  return str.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\${/g, "\\${");
}

function scopeTemplateHtml(html, cssId, doc) {
  const holder = doc.createElement("div");
  holder.innerHTML = html;
  tagDescendants(holder, cssId);
  return holder.innerHTML;
}

function findImportLocal(module, childId, tagLower) {
  for (const imp of module.imports || []) {
    if (!isChjsSource(imp.source)) continue;
    for (const specifier of imp.specifiers || []) {
      if (!specifier.local) continue;
      if (specifier.local.toLowerCase() !== tagLower) continue;
      if (module.importMap.get(tagLower) !== childId) continue;
      return specifier.local;
    }
  }
  return null;
}

function collectBindingNames(fragment) {
  const names = new Set();
  for (const el of fragment.querySelectorAll("*")) {
    for (const attr of el.attributes) {
      if (attr.name.startsWith("bind:")) names.add(attr.value);
    }
  }
  return [...names];
}

/**
 * Generate a CSR class for every module with a template.
 */
export function generateAllCSRClasses(graph, cx) {
  for (const id of [...graph.modules.keys()].sort()) {
    const module = graph.moduleById(id);
    if (module.template) generateCSRClass(module, cx);
  }
}

/**
 * Generate a `ChocolaComponent` subclass for one module.
 *
 * @param {import("./module-graph.js").ChocolaModule} module
 * @param {import("./component-context.js").ProcessContext} cx
 */
export function generateCSRClass(module, cx) {
  if (!module || !module.template) return;

  const canonical = canonicalClassName(module);
  cx.classNames.set(module.id, canonical);

  const key = `${module.id}#${canonical}`;
  if (cx.csrClasses.has(key) || cx.csrGenerating.has(module.id)) return;
  cx.csrGenerating.add(module.id);

  const doc = cx.doc;
  const cssId = cx.cssScopesMap.get(module.id) || module.cssId;
  cx.cssScopesMap.set(module.id, cssId);

  const protectedTemplate = protectCurlyBraces(module.template);
  const template = scopeTemplateHtml(protectedTemplate, cssId, doc);
  const templateFragment = parseFragment(protectedTemplate, doc);

  const childMappings = [];
  const seenTags = new Set();
  for (const el of templateFragment.querySelectorAll("*")) {
    const tag = el.tagName.toLowerCase();
    if (seenTags.has(tag)) continue;
    seenTags.add(tag);

    const child = resolveModuleForTag(module, tag, cx.graph);
    if (!child || !child.template) continue;

    generateCSRClass(child, cx);
    childMappings.push({
      tag,
      compClass: findImportLocal(module, child.id, tag) || canonicalClassName(child),
    });
  }

  if (!cx.usedImports.has(module.id)) {
    const namespaceLocals = new Set(module.namespaceMap.keys());
    cx.usedImports.set(
      module.id,
      (module.imports || [])
        .filter((imp) => !isChjsSource(imp.source))
        .filter(
          (imp) =>
            !(imp.specifiers || []).some(
              (specifier) =>
                specifier.type === "namespace" &&
                specifier.local &&
                namespaceLocals.has(specifier.local.toLowerCase())
            )
        )
        .map((imp) => imp.raw)
    );
  }

  if (module.styles && !cx.styleModules.has(module.id)) {
    cx.styleModules.add(module.id);
    cx.scopedStyles.push(scopeCss(module.styles, cssId));
  }

  const bindingNames = collectBindingNames(templateFragment);
  const runtimeParts = buildRuntimeSource(module, cx, bindingNames, "csr");

  if (
    runtimeParts &&
    !cx.runtimeFunctions.has(module.id) &&
    cx.moduleBindings.has(module.id)
  ) {
    const serverParts = buildRuntimeSource(
      module,
      cx,
      cx.moduleBindings.get(module.id),
      "server"
    );
    if (serverParts) cx.runtimeFunctions.set(module.id, serverParts.namedSource);
  }

  const propsPart =
    module.compProps && module.compProps.length > 0
      ? `{ ${module.compProps
          .map(
            ({ name, defaultValue }) =>
              `${JSON.stringify(name)}: ${
                defaultValue !== undefined ? defaultValue : "null"
              }`
          )
          .join(", ")} }`
      : "{}";
  const runtimePart = runtimeParts
    ? `,\n      runtime: ${runtimeParts.csrSource}`
    : "";
  const childrenPart =
    childMappings.length > 0
      ? ",\n      children: [" +
        childMappings
          .map(({ tag, compClass }) => `{tag:"${tag}",compClass:${compClass}}`)
          .join(",") +
        "]"
      : "";

  const classDef =
    `class ${canonical} extends ChocolaComponent {\n` +
    `  constructor() {\n` +
    `    super({\n` +
    `      template: \`${escapeForTemplateLiteral(template)}\`,\n` +
    `      hash: "${cssId}",\n` +
    `      props: ${propsPart}${runtimePart}${childrenPart}\n` +
    `    });\n` +
    `  }\n` +
    `}`;

  cx.csrGenerating.delete(module.id);
  cx.csrClasses.set(key, classDef);
}
