import { Worker } from "worker_threads";
import { performance } from "perf_hooks";
import path from "path";
import { promises as fs } from "fs";
import { createInterface } from "readline";
import { stdin, stdout } from "process";
import { fileURLToPath } from "url";
import { runtimeFunctionId } from "../compiler/utils.js";
import { makeSyntheticApp } from "./fixtures.js";
import pkg from "../package.json" with { type: "json" };

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const RUNS = {
  reference: 9,
  synthetic: 5,
};

function runScenario(kind, params, runs) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./worker.js", import.meta.url), {
      workerData: { kind, params, runs },
    });
    let settled = false;
    worker.once("message", (msg) => {
      settled = true;
      resolve(msg);
      void worker.terminate();
    });
    worker.once("error", (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
    worker.once("exit", (code) => {
      if (!settled) {
        settled = true;
        reject(new Error(`worker exited with code ${code}`));
      }
    });
  });
}

async function scenario(kind, params, runs) {
  const { stats } = await runScenario(kind, params, runs);
  return stats;
}

function fmt(ms) {
  return ms < 10 ? ms.toFixed(2) + "ms" : ms < 100 ? ms.toFixed(1) + "ms" : Math.round(ms) + "ms";
}

function fmtBytes(b) {
  if (b >= 1024 * 1024) return (b / (1024 * 1024)).toFixed(1) + "MB";
  if (b >= 1024) return (b / 1024).toFixed(1) + "KB";
  return b + "B";
}

const TIME_HEAD = ["step", "median", "p95", "p99", "min", "max", "rss peak", "heap peak"];
const TIME_COLUMNS = [
  ["step", null],
  ["median", "ms"],
  ["p95", "ms"],
  ["p99", "ms"],
  ["min", "ms"],
  ["max", "ms"],
  ["rss peak", "MB"],
  ["heap peak", "MB"],
];

function csvTimeHeader() {
  return TIME_COLUMNS.map(([name, unit]) => (unit ? `${name} (${unit})` : name));
}

function timeRow(step, s, note = "") {
  const label = note ? `${step} ${note}` : step;
  const r3 = (x) => Math.round(x * 1000) / 1000;
  const r1MB = (x) => Math.round(x / (1024 * 1024) * 10) / 10;
  return {
    cells: [
      label,
      fmt(s.median),
      fmt(s.p95),
      fmt(s.p99),
      fmt(s.min),
      fmt(s.max),
      fmtBytes(s.rssPeak),
      fmtBytes(s.heapPeak),
    ],
    raw: [
      label,
      r3(s.median),
      r3(s.p95),
      r3(s.p99),
      r3(s.min),
      r3(s.max),
      r1MB(s.rssPeak),
      r1MB(s.heapPeak),
    ],
  };
}

function derivedRow(step, medianMs) {
  const r3 = (x) => Math.round(x * 1000) / 1000;
  return {
    cells: [step, fmt(medianMs), "-", "-", "-", "-", "-", "-"],
    raw: [step, r3(medianMs), null, null, null, null, null, null],
  };
}

function renderTable(header, rows) {
  const all = [header, ...rows.map((r) => (Array.isArray(r) ? r : r.cells))];
  const widths = all[0].map((_, i) => Math.max(...all.map((r) => r[i].length)));
  return all.map((r) => r.map((c, i) => c.padEnd(widths[i])).join("  ")).join("\n");
}

const recordedTables = [];

function showTable(name, header, rows, csvHeader, csvRows) {
  console.log(renderTable(header, rows));
  recordedTables.push({ name, rows, csvHeader, csvRows });
}

function slug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function csvCell(value) {
  if (value === "-" || value === null || value === undefined) return "";
  const s = String(value);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function rowsToCsv(table) {
  const lines = [table.csvHeader.map(csvCell).join(",")];
  for (const row of table.csvRows) lines.push(row.map(csvCell).join(","));
  return lines.join("\r\n") + "\r\n";
}

async function exportCsvs(tables, dir) {
  const outDir = dir || path.join(__dirname, "results");
  await fs.mkdir(outDir, { recursive: true });
  const written = [];
  for (const table of tables) {
    const file = path.join(outDir, slug(table.name) + ".csv");
    await fs.writeFile(file, rowsToCsv(table));
    written.push(file);
  }
  return written;
}

function askYesNo(question, def) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: stdin, output: stdout });
    rl.question(`${question} (y/N) `, (answer) => {
      rl.close();
      const a = answer.trim().toLowerCase();
      if (a === "y" || a === "yes") resolve(true);
      else if (a === "n" || a === "no") resolve(false);
      else resolve(def);
    });
  });
}

async function benchReference() {
  console.log(`\n== reference: tests/fixtures/basic  (n=${RUNS.reference}) ==`);

  const basic = { app: "basic" };
  const build = await scenario("build", basic, RUNS.reference);
  const render = await scenario("render", basic, RUNS.reference);
  const emitM = await scenario("emit", basic, RUNS.reference);
  const writeOverhead = Math.max(0, emitM.median - render.median);

  const rows = [
    timeRow("buildModuleGraph", build),
    timeRow("renderPage", render),
    timeRow("emit", emitM, "(render + writes)"),
    derivedRow("write overhead (emit - render)", writeOverhead),
  ];
  showTable("reference", TIME_HEAD, rows, csvTimeHeader(), rows.map((r) => r.raw));
}

async function coldBreakdown(name, label, params) {
  const total = await scenario("build", params, RUNS.reference);
  const configM = await scenario("config", params, RUNS.reference);
  const { stats: discoverM, context } = await runScenario("discover", params, RUNS.reference);
  const pageScanM = await scenario("pageScan", params, RUNS.reference);
  const compRemainder = Math.max(0, total.median - configM.median - discoverM.median - pageScanM.median);

  console.log(
    `\nfixture: ${label}  |  components: ${context.components}  |  page source: ${fmtBytes(context.pageBytes)}  (n=${RUNS.reference})`
  );

  const rows = [
    timeRow("config (load + resolvePaths)", configM),
    timeRow("discover (src index + components)", discoverM),
    timeRow("page scan (parse + walk + assets)", pageScanM),
    derivedRow("component compile (remainder)", compRemainder),
    timeRow("total buildModuleGraph", total),
  ];
  showTable(name, TIME_HEAD, rows, csvTimeHeader(), rows.map((r) => r.raw));
}

async function benchColdBuild() {
  console.log("\n== cold build breakdown ==");
  await coldBreakdown("cold-build-basic", "tests/fixtures/basic", { app: "basic" });
  await coldBreakdown("cold-build-components-200", "synthetic components=200", { app: "synthetic", components: 200 });
}

async function benchScaling() {
  console.log(`\n== scaling: synthetic fixtures  (n=${RUNS.synthetic}) ==`);

  const rows = [];

  for (const components of [1, 10, 50, 200, 500, 1500]) {
    const params = { app: "synthetic", components };
    const build = await scenario("build", params, RUNS.synthetic);
    const render = await scenario("render", params, RUNS.synthetic);
    rows.push(timeRow(`components=${components} build`, build));
    rows.push(timeRow(`components=${components} render`, render));
  }

  for (const depth of [1, 5, 10]) {
    const params = { app: "synthetic", depth };
    const build = await scenario("build", params, RUNS.synthetic);
    const render = await scenario("render", params, RUNS.synthetic);
    rows.push(timeRow(`nested depth=${depth} build`, build));
    rows.push(timeRow(`nested depth=${depth} render`, render));
  }

  for (const pageSizeKb of [64, 256]) {
    const params = { app: "synthetic", pageSizeKb };
    const build = await scenario("build", params, RUNS.synthetic);
    const render = await scenario("render", params, RUNS.synthetic);
    rows.push(timeRow(`page source=${pageSizeKb}kb build`, build));
    rows.push(timeRow(`page source=${pageSizeKb}kb render`, render));
  }

  showTable("scaling", TIME_HEAD, rows, csvTimeHeader(), rows.map((r) => r.raw));
}

async function benchStableIds() {
  console.log("\n== stable-id overhead (in-process) ==");

  const names = Array.from({ length: 200 }, (_, i) => `c${i}.html`);
  const t0 = performance.now();
  for (const name of names) {
    runtimeFunctionId(name);
  }
  const total = (performance.now() - t0) * 1000;

  const { root, cleanup } = await makeSyntheticApp({ components: 200 });
  let buildMs = 0;
  try {
    const stats = await scenario("build", { app: "synthetic", components: 200 }, RUNS.synthetic);
    buildMs = stats.median;
  } finally {
    await cleanup();
  }

  const micro = total / names.length;
  const pct = buildMs > 0 ? ((total / 1000 / buildMs) * 100).toFixed(2) + "%" : "-";

  const rows = [
    [`runtimeFunctionId x${names.length}`, micro.toFixed(1) + "us/call"],
    ["total hashing", total.toFixed(1) + "us"],
    ["vs build (components=200)", pct],
  ];
  showTable("stable-id", ["measure", "value"], rows, ["measure", "value"], rows);
}

async function main() {
  const args = process.argv.slice(2);
  const csvMode = args.includes("--csv") ? true : args.includes("--no-csv") ? false : null;
  const csvDirArg = args.find((a) => a.startsWith("--csv-dir="))?.split("=")[1];

  console.log(
    [
      `chocola ${pkg.version}`,
      `node ${process.version}`,
      `${process.platform}/${process.arch}`,
      "worker-isolated per scenario",
    ].join(" | ")
  );

  await benchReference();
  await benchColdBuild();
  await benchScaling();
  await benchStableIds();

  let exportCsv = csvMode;
  if (exportCsv === null && stdin.isTTY) {
    exportCsv = await askYesNo("Export all tables to CSV files?", false);
  }

  if (exportCsv) {
    const files = await exportCsvs(recordedTables, csvDirArg);
    console.log("\nexported:");
    for (const file of files) console.log("  " + file);
  }

  console.log("\ndone.");
}

await main();