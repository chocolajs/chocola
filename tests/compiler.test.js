import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

import compile, {
  buildModuleGraph,
  renderPage,
  emit,
  app,
  ModuleGraph,
  ChocolaModule,
} from "../compiler/index.js";
import { deterministicHash } from "../compiler/utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "fixtures", "basic");

let tmpParent;
let tmpRoot;
let graph;

before(async () => {
  tmpParent = await fs.mkdtemp(path.join(os.tmpdir(), "chocola-test-"));
  tmpRoot = path.join(tmpParent, "app");
  await fs.cp(FIXTURE, tmpRoot, { recursive: true });
  graph = await buildModuleGraph(tmpRoot);
});

after(async () => {
  await fs.rm(tmpParent, { recursive: true, force: true });
});

async function listDir(dir) {
  try {
    return (await fs.readdir(dir)).sort();
  } catch {
    return [];
  }
}

function runtimeFunctionNames(result) {
  const file = result.files.find((f) => f.content.includes("DOMContentLoaded"));
  assert.ok(file, "expected a DOMContentLoaded runtime chunk");
  const names = [
    ...new Set(
      [...file.content.matchAll(/\br_[a-z]{8}\s*\(/g)].map((m) => m[0].replace(/\s*\($/, ""))
    ),
  ];
  return names;
}

test("compiler entry point exports the module pipeline", () => {
  assert.equal(typeof buildModuleGraph, "function");
  assert.equal(typeof renderPage, "function");
  assert.equal(typeof emit, "function");
  assert.equal(typeof compile, "function");
  assert.equal(typeof app.build, "function");
  assert.equal(typeof ModuleGraph, "function");
  assert.equal(typeof ChocolaModule, "function");
});

test("buildModuleGraph discovers page, components and asset modules", () => {
  assert.ok(graph instanceof ModuleGraph);
  assert.ok(graph.page instanceof ChocolaModule);
  assert.equal(graph.page.id, "index.html");
  assert.equal(graph.page.kind, "page");

  for (const comp of ["greeting.html", "counter.html", "card.html", "action.html"]) {
    assert.ok(graph.components.has(comp), `missing component module ${comp}`);
    assert.equal(graph.components.get(comp).kind, "component");
  }

  for (const id of ["styles.css", "favicon.ico", "app.js"]) {
    assert.ok(graph.modules.has(id), `missing asset module ${id}`);
  }

  for (const dep of [
    "lib/greeting.html",
    "lib/counter.html",
    "lib/card.html",
    "styles.css",
    "favicon.ico",
    "app.js",
  ]) {
    assert.ok(graph.page.deps.has(dep), `page missing dep ${dep}`);
  }

  assert.ok(graph.components.get("card.html").deps.has("lib/action.html"), "card should depend on action (tag + import)");
});

test("renderPage is a pure function that writes nothing", async () => {
  const before = await listDir(path.join(tmpRoot, "dist"));
  const result = await renderPage(graph);
  const after = await listDir(path.join(tmpRoot, "dist"));

  assert.deepEqual(after, before, "renderPage must not touch the output directory");

  assert.equal(typeof result.html, "string");
  assert.ok(result.html.length > 0);
  assert.equal(typeof result.hashMap, "object");
  assert.ok(Array.isArray(result.files));
  assert.ok(Array.isArray(result.copies));
});

test("renderPage emits scoped css, runtime chunks and asset descriptors", async () => {
  const result = await renderPage(graph);

  assert.ok(result.files.some((f) => /^sc-[a-z0-9]+\.css$/.test(f.path)), "missing scoped css descriptor");
  assert.equal(result.files.filter((f) => /^run-[a-z0-9]+\.js$/.test(f.path)).length, 3, "expected three runtime files");
  assert.ok(result.files.some((f) => /^css-[a-z0-9]+\.css$/.test(f.path)), "missing bundled stylesheet");
  assert.ok(result.files.some((f) => /^js-[a-z0-9]+\.js$/.test(f.path)), "missing bundled script");

  const copyTargets = result.copies.map((c) => c.to.split(path.sep).pop());
  assert.ok(copyTargets.includes("favicon.ico"), "missing favicon copy op");
  assert.ok(copyTargets.includes("static"), "missing static dir copy op");
});

test("emit writes the full static site to the output directory", async () => {
  await fs.mkdir(path.join(tmpRoot, "dist"), { recursive: true });
  await fs.writeFile(path.join(tmpRoot, "dist", "stray.txt"), "stale output");

  await emit(graph);

  const entries = await fs.readdir(path.join(tmpRoot, "dist"));
  assert.ok(!entries.includes("stray.txt"), "emptyOutDir should wipe previous output");
  assert.ok(entries.includes("index.html"));
  assert.ok(entries.some((f) => /^css-[a-z0-9]+\.css$/.test(f)), "missing bundled css output");
  assert.ok(entries.some((f) => /^js-[a-z0-9]+\.js$/.test(f)), "missing bundled js output");
  assert.ok(entries.some((f) => /^sc-[a-z0-9]+\.css$/.test(f)), "missing scoped css output");
  assert.equal(entries.filter((f) => /^run-[a-z0-9]+\.js$/.test(f)).length, 3, "expected three runtime files");
  assert.ok(entries.includes("favicon.ico"), "missing copied icon");

  const staticEntries = await fs.readdir(path.join(tmpRoot, "dist", "static"));
  assert.ok(staticEntries.includes("hello.txt"), "static dir not copied");

  const hashesPath = path.join(tmpRoot, ".chocola", "hashes.json");
  const hashes = JSON.parse(await fs.readFile(hashesPath, "utf8"));
  assert.deepEqual(hashes, {
    "action.html": deterministicHash("action.html", 8),
    "greeting.html": deterministicHash("greeting.html", 8),
    "counter.html": deterministicHash("counter.html", 8),
    "card.html": deterministicHash("card.html", 8),
  });
});

test("emitted html contains interpolated, scoped and slotted content", async () => {
  const html = await fs.readFile(path.join(tmpRoot, "dist", "index.html"), "utf8");

  assert.ok(html.includes("Hello World!"), "prop interpolation missing");
  assert.ok(html.includes("slot content"), "slot projection missing");
  assert.ok(html.includes("never shown") && html.includes("style=\"display:none\""), "page-level if=false element should be hidden");
  assert.ok(html.includes(`class="greeting ${deterministicHash("greeting.html", 8)}"`), "scoped css class missing on root");
});

test("runtime function ids are stable per-module hashes", async () => {
  const secondGraph = await buildModuleGraph(tmpRoot);

  const namesA = runtimeFunctionNames(await renderPage(graph));
  const namesB = runtimeFunctionNames(await renderPage(secondGraph));
  const namesC = runtimeFunctionNames(await renderPage(secondGraph));

  assert.deepEqual(namesA, namesB, "ids must not depend on traversal order or build");
  assert.deepEqual(namesB, namesC);

  assert.ok(namesA.includes("r_" + deterministicHash("counter.html", 8)), "counter runtime id should derive from its filename");
  assert.ok(namesA.includes("r_" + deterministicHash("action.html", 8)), "action runtime id should derive from its filename");
});

test("compile() is emit(buildModuleGraph())", async () => {
  const outDir = path.join(tmpRoot, "dist");
  await fs.rm(outDir, { recursive: true, force: true });

  await compile(tmpRoot);

  assert.ok((await fs.readdir(outDir)).includes("index.html"), "compile should produce the static site");
});
