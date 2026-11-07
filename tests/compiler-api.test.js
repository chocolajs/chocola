import { test, describe } from "node:test";
import assert from "node:assert/strict";

import * as compiler from "../compiler/index.js";
import {
  buildModuleGraph,
  ChocolaModule,
  ModuleGraph,
} from "../compiler/index.js";
import { normalizeConfig } from "../compiler/config.js";
import { mkTmpApp, cleanupTmp } from "./helpers.js";

describe("compiler API — exports", () => {
  test("exposes the import-based graph entry points", () => {
    assert.equal(typeof buildModuleGraph, "function");
    assert.equal(typeof ChocolaModule, "function");
    assert.equal(typeof ModuleGraph, "function");
    assert.equal(compiler.buildModuleGraph, buildModuleGraph);
    assert.equal(compiler.ChocolaModule, ChocolaModule);
    assert.equal(compiler.ModuleGraph, ModuleGraph);
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
