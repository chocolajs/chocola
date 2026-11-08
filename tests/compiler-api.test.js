import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "fs";
import path from "path";

import * as compiler from "../compiler/index.js";
import {
  buildModuleGraph,
  ChocolaModule,
  ModuleGraph,
  render,
  compile,
} from "../compiler/index.js";
import { normalizeConfig } from "../compiler/config.js";
import { mkTmpApp, cleanupTmp } from "./helpers.js";

async function snapshot(dir) {
  const entries = [];

  async function walk(current) {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        entries.push(path.relative(dir, full) + "/");
        await walk(full);
      } else {
        entries.push(path.relative(dir, full));
      }
    }
  }

  await walk(dir);
  return entries.sort();
}

describe("compiler API — exports", () => {
  test("exposes the graph, render, and compile entry points", () => {
    assert.equal(typeof buildModuleGraph, "function");
    assert.equal(typeof ChocolaModule, "function");
    assert.equal(typeof ModuleGraph, "function");
    assert.equal(typeof render, "function");
    assert.equal(typeof compile, "function");
    assert.equal(compiler.buildModuleGraph, buildModuleGraph);
    assert.equal(compiler.render, render);
    assert.equal(compiler.compile, compile);
    assert.equal(typeof compiler.normalizeConfig, "function");
  });

  test("no longer exposes page, emit, or app APIs", () => {
    for (const removed of ["renderPage", "emit", "app"]) {
      assert.equal(removed in compiler, false, removed);
    }
  });

  test("builds a graph through the public export", async () => {
    const { tmpParent, tmpRoot } = await mkTmpApp({
      "app.chjs": `<template><div /></template>`,
    });

    try {
      const graph = await buildModuleGraph(tmpRoot, { entry: "app.chjs" });
      assert.ok(graph instanceof ModuleGraph);
      assert.equal(graph.entry, "app.chjs");
      assert.equal(graph.moduleById("app.chjs"), graph.root);
      assert.equal(normalizeConfig().treeShakeRuntime, true);
    } finally {
      await cleanupTmp(tmpParent);
    }
  });
});

describe("compiler API — in-memory results", () => {
  test("render returns the result shape and writes nothing", async () => {
    const { tmpParent, tmpRoot } = await mkTmpApp({
      "app.chjs": `<template><div>hello</div></template>`,
    });

    try {
      const before = await snapshot(tmpRoot);
      const graph = await buildModuleGraph(tmpRoot, { entry: "app.chjs" });
      const result = await render(graph);

      assert.deepEqual(Object.keys(result).sort(), [
        "hashMap",
        "html",
        "runtime",
        "styles",
      ]);
      assert.match(result.html, /hello/);
      assert.deepEqual(await snapshot(tmpRoot), before);
    } finally {
      await cleanupTmp(tmpParent);
    }
  });

  test("compile builds and renders without writing output", async () => {
    const { tmpParent, tmpRoot } = await mkTmpApp({
      "app.chjs":
        `<script>export let name = "World";</script>` +
        `<template><p>Hello {name}</p></template>`,
    });

    try {
      const before = await snapshot(tmpRoot);
      const result = await compile(tmpRoot, {
        entry: "app.chjs",
        ctx: { name: "Ada" },
      });

      assert.deepEqual(Object.keys(result).sort(), [
        "hashMap",
        "html",
        "runtime",
        "styles",
      ]);
      assert.match(result.html, /Hello Ada/);
      assert.deepEqual(await snapshot(tmpRoot), before);
    } finally {
      await cleanupTmp(tmpParent);
    }
  });

  test("compile forwards config and entry", async () => {
    const { tmpParent, tmpRoot } = await mkTmpApp({
      "view.chjs": `<template><div>custom entry</div></template>`,
    });

    try {
      const result = await compile(tmpRoot, {
        entry: "view.chjs",
        config: { treeShakeRuntime: false },
      });

      assert.match(result.html, /custom entry/);
      assert.match(result.runtime[0].content, /export \{ ChocolaComponent \};/);
      assert.equal(
        result.runtime.some((file) => file.content.includes("DOMContentLoaded")),
        false
      );
    } finally {
      await cleanupTmp(tmpParent);
    }
  });
});
