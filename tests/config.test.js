import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

import { loadConfig, resolvePaths } from "../compiler/config.js";
import { mkTmpFromFixture, cleanupTmp } from "./helpers.js";

let tmpParent;
let tmpRoot;

before(async () => {
  ({ tmpParent, tmpRoot } = await mkTmpFromFixture("basic"));
});

after(async () => {
  await cleanupTmp(tmpParent);
});

async function mkBareTmp() {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "chocola-cfg-"));
  const root = path.join(parent, "app");
  await fs.mkdir(path.join(root, "src", "lib"), { recursive: true });
  await fs.writeFile(path.join(root, "src", "index.html"), "<html><body><app></app></body></html>");
  return { parent, root };
}

describe("config — loadConfig defaults", () => {
  test("zero-config returns defaults without throwing", async () => {
    const { parent, root } = await mkBareTmp();
    try {
      const cfg = await loadConfig(root);
      assert.equal(cfg.srcDir, "src");
      assert.equal(cfg.outDir, "dist");
      assert.equal(cfg.libDir, "lib");
      assert.equal(cfg.emptyOutDir, true);
    } finally {
      await fs.rm(parent, { recursive: true, force: true });
    }
  });

  test("partial bundle fills remaining defaults", async () => {
    const { parent, root } = await mkBareTmp();
    try {
      await fs.writeFile(path.join(root, "chocola.config.json"), JSON.stringify({ bundle: { srcDir: "src", outDir: "dist" } }));
      const cfg = await loadConfig(root);
      assert.equal(cfg.srcDir, "src");
      assert.equal(cfg.outDir, "dist");
      assert.equal(cfg.libDir, "lib");
    } finally {
      await fs.rm(parent, { recursive: true, force: true });
    }
  });

  test("legacy build key is honored", async () => {
    const { parent, root } = await mkBareTmp();
    try {
      await fs.writeFile(path.join(root, "chocola.config.json"), JSON.stringify({ build: { outDir: "build" } }));
      const cfg = await loadConfig(root);
      assert.equal(cfg.outDir, "build");
      assert.equal(cfg.srcDir, "src");
    } finally {
      await fs.rm(parent, { recursive: true, force: true });
    }
  });

  test("malformed config falls back to defaults", async () => {
    const { parent, root } = await mkBareTmp();
    try {
      await fs.writeFile(path.join(root, "chocola.config.json"), "{ not json");
      const cfg = await loadConfig(root);
      assert.equal(cfg.srcDir, "src");
      assert.equal(cfg.outDir, "dist");
      assert.equal(cfg.libDir, "lib");
    } finally {
      await fs.rm(parent, { recursive: true, force: true });
    }
  });

  test("fixture bundle config is read", async () => {
    const cfg = await loadConfig(tmpRoot);
    assert.equal(cfg.srcDir, "src");
    assert.equal(cfg.outDir, "dist");
    assert.equal(cfg.libDir, "lib");
  });
});

describe("config — overrides and customPath", () => {
  test("overrides win over file values", async () => {
    const cfg = await loadConfig(tmpRoot, { overrides: { outDir: "custom_out", libDir: "components" } });
    assert.equal(cfg.outDir, "custom_out");
    assert.equal(cfg.libDir, "components");
    assert.equal(cfg.srcDir, "src");
  });

  test("customPath reads an explicit config file", async () => {
    const altPath = path.join(tmpRoot, "alt.json");
    await fs.writeFile(altPath, JSON.stringify({ bundle: { srcDir: "src", outDir: "alt_out" } }));
    try {
      const cfg = await loadConfig(tmpRoot, { customPath: altPath });
      assert.equal(cfg.outDir, "alt_out");
    } finally {
      await fs.rm(altPath, { force: true });
    }
  });

  test("missing customPath falls back to defaults", async () => {
    const cfg = await loadConfig(tmpRoot, { customPath: path.join(tmpRoot, "nonexistent.json") });
    assert.equal(cfg.outDir, "dist");
  });
});

describe("config — compiler flags and resolvePaths", () => {
  test("treeShakeRuntime defaults true and can be disabled", async () => {
    const def = await loadConfig(tmpRoot);
    assert.equal(def.treeShakeRuntime, true);
    const { parent, root } = await mkBareTmp();
    try {
      await fs.writeFile(
        path.join(root, "chocola.config.json"),
        JSON.stringify({ bundle: {}, compiler: { treeShakeRuntime: false } })
      );
      const cfg = await loadConfig(root);
      assert.equal(cfg.treeShakeRuntime, false);
    } finally {
      await fs.rm(parent, { recursive: true, force: true });
    }
  });

  test("resolvePaths joins relative dirs onto rootDir", async () => {
    const cfg = await loadConfig(tmpRoot);
    const paths = resolvePaths(tmpRoot, cfg);
    assert.equal(paths.outDir, path.join(tmpRoot, "dist"));
    assert.equal(paths.src, path.join(tmpRoot, "src"));
    assert.equal(paths.components, path.join(tmpRoot, "src", "lib"));
  });

  test("resolvePaths honors absolute dirs", async () => {
    const cfg = { srcDir: path.join(tmpRoot, "src"), outDir: path.join(tmpRoot, "elsewhere"), libDir: "lib" };
    const paths = resolvePaths(tmpRoot, cfg);
    assert.equal(paths.outDir, path.join(tmpRoot, "elsewhere"));
    assert.equal(paths.components, path.join(cfg.srcDir, "lib"));
  });
});
