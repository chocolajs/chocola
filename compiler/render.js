import { promises as fs } from "fs";
import { createRenderDocument, serializeFragment } from "./dom-processor.js";
import {
  ProcessContext,
  renderInstance,
  generateAllCSRClasses,
  buildModuleChunks,
} from "./component-processor.js";
import { generateRuntime } from "./runtime-generator.js";

let baseRuntimePromise = null;

function readBaseRuntime() {
  if (!baseRuntimePromise) {
    baseRuntimePromise = fs.readFile(
      new URL("../runtime/index.js", import.meta.url),
      "utf-8"
    );
  }
  return baseRuntimePromise;
}

/**
 * Render a module graph to an in-memory result.
 *
 * The function is pure: it creates a fresh render document and context per
 * call, reads no project files, and writes nothing.
 *
 * @param {import("./module-graph.js").ModuleGraph} graph
 * @param {object} [ctx]
 * @returns {Promise<{
 *   html: string,
 *   styles: string,
 *   runtime: Array<{name:string, content:string}>,
 *   hashMap: Record<string, string>
 * }>}
 */
export async function render(graph, ctx = {}) {
  if (!graph || !graph.root || !graph.modules) {
    throw new Error("render(graph) requires a module graph built by buildModuleGraph");
  }

  const doc = createRenderDocument();
  const cx = new ProcessContext(graph, doc);

  for (const [id, module] of graph.modules) {
    if (module.template) cx.cssScopesMap.set(id, module.cssId);
  }

  const rootFragment = renderInstance(graph.root, null, cx, [], null, null, ctx);

  // Every template-bearing module gets a CSR class so hosts can mount
  // imported components directly.
  generateAllCSRClasses(graph, cx);

  const moduleChunks = buildModuleChunks(graph, cx);
  const baseSource = await readBaseRuntime();
  const runtime = generateRuntime({
    baseSource,
    moduleChunks,
    runtimeCalls: cx.runtimeCalls,
  });

  const html = serializeFragment(rootFragment, doc);
  const styles = cx.scopedStyles.join("\n");

  const hashMap = {};
  for (const [id, cssId] of [...cx.cssScopesMap.entries()].sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    hashMap[id] = cssId;
  }

  return { html, styles, runtime, hashMap };
}
