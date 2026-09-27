import { promises as fs } from "fs";
import path from "path";
import { performance } from "perf_hooks";
import { buildModuleGraph } from "./module-graph.js";
import { renderPage } from "./render.js";
import { writeHTMLOutput } from "./dom-processor.js";

export { buildModuleGraph } from "./module-graph.js";
export { renderPage } from "./render.js";
export { ChocolaModule, ModuleGraph } from "./module-graph.js";

async function setupOutputDirectory(outDirPath, emptyOutDir) {
  if (emptyOutDir) {
    await fs.rm(outDirPath, { recursive: true, force: true });
    await fs.mkdir(outDirPath);
  }
}

export async function emit(graph, options = {}) {
  const outDir = graph.paths.outDir;
  await setupOutputDirectory(outDir, graph.config.emptyOutDir);

  const result = await renderPage(graph, options.ctx);

  for (const file of result.files) {
    await fs.writeFile(path.join(outDir, file.path), file.content);
  }

  for (const copy of result.copies) {
    if (copy.recursive) {
      await fs.cp(copy.from, copy.to, { recursive: true, force: true });
    } else {
      await fs.copyFile(copy.from, copy.to);
    }
  }

  await writeHTMLOutput(result.html, outDir);

  const chocolaDir = path.join(graph.rootDir, ".chocola");
  await fs.mkdir(chocolaDir, { recursive: true });
  await fs.writeFile(path.join(chocolaDir, "hashes.json"), JSON.stringify(result.hashMap, null, 2) + "\n");

  return result;
}

export default async function compile(rootDir, buildConfig = {}) {
  const isHotReload = buildConfig?.isHotReload || null;
  const overrides = buildConfig?.overrides || null;
  const silent = buildConfig?.silent || false;
  const startTime = performance.now();

  const graph = await buildModuleGraph(rootDir, { overrides });

  await emit(graph);

  const durationMs = performance.now() - startTime;
}

export const app = {
  async build(__rootdir) { return compile(__rootdir) }
};
