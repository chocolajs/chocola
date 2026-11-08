import { parentPort, workerData } from "worker_threads";
import { performance } from "perf_hooks";
import { buildModuleGraph, render, compile } from "../compiler/index.js";
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

function graphContext(graph) {
  return {
    modules: graph.modules.size,
    rootTemplateBytes: graph.root?.template?.length || 0,
  };
}

async function loadGraph(app) {
  return quiet(() => buildModuleGraph(app.root, { entry: "app.chjs" }));
}

async function scenarioBuild(app, runs) {
  const stats = await measure(
    () => buildModuleGraph(app.root, { entry: "app.chjs" }),
    runs
  );
  const graph = await loadGraph(app);
  return { stats, context: graphContext(graph) };
}

async function scenarioRender(app, runs) {
  const graph = await loadGraph(app);
  const stats = await measure(() => render(graph), runs);
  return { stats, context: graphContext(graph) };
}

async function scenarioCompile(app, runs) {
  const stats = await measure(
    () => compile(app.root, { entry: "app.chjs" }),
    runs
  );
  return { stats, context: null };
}

const SCENARIOS = {
  build: scenarioBuild,
  render: scenarioRender,
  compile: scenarioCompile,
};

const { kind, params, runs } = workerData;

const app =
  params.app === "basic"
    ? await makeTempApp(writeBasicApp)
    : await makeSyntheticApp(params);

try {
  const result = await SCENARIOS[kind](app, runs);
  parentPort.postMessage(result);
} finally {
  await app.cleanup();
}
