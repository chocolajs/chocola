/**
 * Chocola compiler entry points.
 *
 * Core builds an import-based module graph from a `.chjs` entry. Render and
 * runtime descriptors are layered on top without reading project config or
 * writing output.
 */
export { buildModuleGraph, ChocolaModule, ModuleGraph } from "./module-graph.js";
export { normalizeConfig } from "./config.js";
