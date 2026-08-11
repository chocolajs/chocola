import { promises as fs } from "fs";
import path from "path";
import { performance } from "perf_hooks";
import chalk from "./chalk.js";
import { buildModuleGraph } from "./module-graph.js";
import { renderPage } from "./render.js";
import { writeHTMLOutput } from "./dom-processor.js";

export { buildModuleGraph } from "./module-graph.js";
export { renderPage } from "./render.js";
export { ChocolaModule, ModuleGraph } from "./module-graph.js";

const GOLD_COLOR = "#D87416";
const WHITE_COLOR = "#FAFAF8";
const TEXT_FAINT = "#E7EBE1";

function logBanner() {
  console.log(
    chalk.hex(GOLD_COLOR)(`
   ┌─────────────────────────────────────────────┐
   │┌-------------------------------------------┐│
   ││                                           ││`)
  );
  console.log(
    chalk.hex(GOLD_COLOR)(`   ││            `) +
    chalk.bold.hex(WHITE_COLOR)(`{`) +
    chalk.bold.hex(GOLD_COLOR)(`  C H O C O L A  `) +
    chalk.bold.hex(WHITE_COLOR)(`}`) +
    chalk.hex(GOLD_COLOR)(`            ││\n`) +
    chalk.hex(GOLD_COLOR)(`   ││                                           ││
   ││     `) +
   chalk.hex(TEXT_FAINT)(`THE SWEETEST WAY TO BUILD THE WEB`) +
   chalk.hex(GOLD_COLOR)(`     ││
   ││                                           ││
   │└-------------------------------------------┘│
   └─────────────────────────────────────────────┘
   `)
  );
}

function logSuccess(outDirPath, durationMs) {
  console.log(
    chalk.bold.green(">"),
    "Project bundled succesfully at",
    chalk.green.underline(outDirPath));
    console.log(chalk.bold.green(`\nJOB DONE!`) + chalk.hex(TEXT_FAINT)(` (${formatDuration(durationMs)})\n`));
}

function formatDuration(ms) {
  if (ms >= 1000) return (ms / 1000).toFixed(2) + "s";
  return Math.round(ms) + "ms";
}

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

export default async function compile(rootDir, buildConfig) {
  const isHotReload = buildConfig?.isHotReload || null;
  const startTime = performance.now();
  !isHotReload && logBanner();

  const graph = await buildModuleGraph(rootDir);

  !isHotReload && console.log(chalk.bold.green(">"), "Creating Chocola static build in directory", chalk.green.underline(graph.paths.outDir));

  await emit(graph);

  const durationMs = performance.now() - startTime;

  !isHotReload && logSuccess(graph.paths.outDir, durationMs);
  isHotReload && console.log("Dev server updated " + chalk.hex(TEXT_FAINT)(`(${formatDuration(durationMs)})`));
}

/**
 * An intrinsic object that contains the Chocola App methods.
 */
export const app = {
  /**
 *  Initializes your Chocola App using a root directory.
 * 
 * ```js
 * import { app } from "chocola/compiler"
  import path from "path";
  import { fileURLToPath } from "url";
  
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  
  app.build(__dirname);
  ```
 * @example
 * @param {PathLike} __rootdir the directory where your Chocola App is
 */
  async build(__rootdir) { return compile(__rootdir) }
};
