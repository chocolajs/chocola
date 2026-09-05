import { parentPort, workerData } from "worker_threads";
import { performance } from "perf_hooks";
import path from "path";
import { buildModuleGraph, renderPage, emit } from "../compiler/index.js";
import { loadConfig, resolvePaths } from "../compiler/config.js";
import { getSrcIndex, getComponents } from "../compiler/pipeline.js";
import { ModuleGraph, ChocolaModule } from "../compiler/module-graph.js";
import { createDOM, getAssetLinks, getScriptElements } from "../compiler/dom-processor.js";
import { writeBasicApp, makeTempApp, makeSyntheticApp } from "./fixtures.js";

async function quiet(fn) {
  const log = console.log;
  const warn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  try {
    return await fn();
  } finally {
    console.log = log;
    console.warn = warn;
  }
}

function percentile(sorted, p) {
  const n = sorted.length;
  if (n === 0) return 0;
  if (n === 1) return sorted[0];
  const rank = (p / 100) * (n - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  const frac = rank - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * frac;
}

async function measure(fn, runs) {
  await quiet(fn);
  const times = [];
  const rss = [];
  const heap = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    await quiet(fn);
    times.push(performance.now() - t0);
    const m = process.memoryUsage();
    rss.push(m.rss);
    heap.push(m.heapUsed);
  }
  times.sort((a, b) => a - b);
  return {
    median: percentile(times, 50),
    p95: percentile(times, 95),
    p99: percentile(times, 99),
    min: times[0],
    max: times[times.length - 1],
    rssPeak: Math.max(...rss),
    heapPeak: Math.max(...heap),
  };
}

function buildReplicaGraph(root, config, paths, srcIndex, components) {
  const graph = new ModuleGraph(root, config, paths);
  graph.addModule(
    new ChocolaModule({
      id: "index.html",
      kind: "page",
      sourcePath: srcIndex.srcPath,
      source: srcIndex.srcHtmlFile,
      mtimeMs: null,
    })
  );
  graph.page = graph.modules.get("index.html");
  for (const filename of components.componentsLib) {
    const compName = filename.toLowerCase();
    const source = components.loadedComponents.get(compName);
    if (source === undefined) continue;
    graph.addModule(
      new ChocolaModule({
        id: path.posix.join(config.libDir, compName),
        kind: "component",
        sourcePath: path.join(paths.components, filename),
        source,
        mtimeMs: null,
      })
    );
  }
  return graph;
}

function pageScanReplica(root, config, paths, srcIndex, components) {
  const graph = buildReplicaGraph(root, config, paths, srcIndex, components);
  const pageDom = createDOM(srcIndex.srcHtmlFile);
  let found = 0;
  for (const el of pageDom.document.querySelectorAll("*")) {
    if (graph.component(el.tagName.toLowerCase() + ".html")) found++;
  }
  const { stylesheets, icons } = getAssetLinks(pageDom.document);
  const scripts = getScriptElements(pageDom.document);
  for (const link of [...stylesheets, ...icons]) {
    if (!/^https?:/i.test(link.href)) found++;
  }
  for (const script of scripts) {
    const src = script.getAttribute("src");
    if (src && !/^https?:/i.test(src)) found++;
  }
  return found;
}

async function contextFor(app) {
  const config = await loadConfig(app.root);
  const paths = resolvePaths(app.root, config);
  const srcIndex = await getSrcIndex(paths.src);
  const components = await getComponents(paths.components);
  return {
    components: components.componentsLib.length,
    pageBytes: srcIndex.srcHtmlFile ? srcIndex.srcHtmlFile.length : 0,
  };
}

async function scenarioBuild(app, runs) {
  return measure(() => buildModuleGraph(app.root), runs);
}

async function scenarioRender(app, runs) {
  const graph = await quiet(() => buildModuleGraph(app.root));
  return measure(() => renderPage(graph), runs);
}

async function scenarioEmit(app, runs) {
  const graph = await quiet(() => buildModuleGraph(app.root));
  return measure(() => emit(graph), runs);
}

async function scenarioConfig(app, runs) {
  return measure(async () => {
    const config = await loadConfig(app.root);
    resolvePaths(app.root, config);
  }, runs);
}

async function scenarioDiscover(app, runs) {
  const setup = await quiet(async () => {
    const config = await loadConfig(app.root);
    const paths = resolvePaths(app.root, config);
    const srcIndex = await getSrcIndex(paths.src);
    const components = await getComponents(paths.components);
    return { paths, srcIndex, components };
  });
  const stats = await measure(async () => {
    await getSrcIndex(setup.paths.src);
    await getComponents(setup.paths.components);
  }, runs);
  return { stats, context: { components: setup.components.componentsLib.length, pageBytes: setup.srcIndex.srcHtmlFile ? setup.srcIndex.srcHtmlFile.length : 0 } };
}

async function scenarioPageScan(app, runs) {
  const setup = await quiet(async () => {
    const config = await loadConfig(app.root);
    const paths = resolvePaths(app.root, config);
    const srcIndex = await getSrcIndex(paths.src);
    const components = await getComponents(paths.components);
    return { config, paths, srcIndex, components };
  });
  const stats = await measure(async () => {
    pageScanReplica(app.root, setup.config, setup.paths, setup.srcIndex, setup.components);
  }, runs);
  return { stats, context: null };
}

const SCENARIOS = {
  build: scenarioBuild,
  render: scenarioRender,
  emit: scenarioEmit,
  config: scenarioConfig,
  discover: scenarioDiscover,
  pageScan: scenarioPageScan,
};

const { kind, params, runs } = workerData;

const app =
  params.app === "basic"
    ? await makeTempApp(writeBasicApp)
    : await makeSyntheticApp(params);

try {
  const result = await SCENARIOS[kind](app, runs);
  const msg = kind === "discover" || kind === "pageScan" ? result : { stats: result, context: null };
  parentPort.postMessage(msg);
} finally {
  await app.cleanup();
}