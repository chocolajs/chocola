/**
 * Chocola compiler entry points.
 *
 * Core builds an import-based module graph from a `.chjs` entry and renders it
 * to an in-memory fragment plus runtime descriptors. It never reads project
 * config, writes output, or assembles a document.
 */
export { buildModuleGraph, ChocolaModule, ModuleGraph } from "./module-graph.js";
export { render } from "./render.js";
export { normalizeConfig } from "./config.js";

import { buildModuleGraph } from "./module-graph.js";
import { render } from "./render.js";

/**
 * Build a graph and render it in one call.
 *
 * @param {string} rootDir absolute project root
 * @param {{entry?: string, config?: object, ctx?: object}} [options]
 * @returns {Promise<{html:string, styles:string, runtime:Array<{name:string, content:string}>, hashMap:Record<string,string>}>}
 */
export async function compile(rootDir, options = {}) {
  const graph = await buildModuleGraph(rootDir, options);
  return render(graph, options.ctx);
}
