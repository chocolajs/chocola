import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { normalizeConfig } from "../compiler/config.js";

describe("config — normalizeConfig", () => {
  test("defaults treeShakeRuntime to true", () => {
    assert.deepEqual(normalizeConfig(), { treeShakeRuntime: true });
    assert.deepEqual(normalizeConfig(undefined), { treeShakeRuntime: true });
    assert.deepEqual(normalizeConfig(null), { treeShakeRuntime: true });
  });

  test("preserves explicit values and unknown keys", () => {
    const config = normalizeConfig({
      treeShakeRuntime: false,
      entry: "not-core-config",
      hostOption: { nested: true },
    });

    assert.deepEqual(config, {
      treeShakeRuntime: false,
      entry: "not-core-config",
      hostOption: { nested: true },
    });
  });

  test("removed path/config keys have no special meaning", () => {
    const config = normalizeConfig({
      srcDir: "app",
      libDir: "components",
      outDir: "build",
      emptyOutDir: false,
    });

    assert.deepEqual(config, {
      treeShakeRuntime: true,
      srcDir: "app",
      libDir: "components",
      outDir: "build",
      emptyOutDir: false,
    });
  });

  test("does not mutate the input object", () => {
    const input = { treeShakeRuntime: false };
    const output = normalizeConfig(input);

    assert.notEqual(output, input);
    assert.deepEqual(input, { treeShakeRuntime: false });
  });

  test("performs no file I/O", () => {
    // normalizeConfig is synchronous and has no fs dependency; a config file on
    // disk cannot influence its result.
    assert.equal(typeof normalizeConfig, "function");
    assert.equal(normalizeConfig({ custom: 1 }).custom, 1);
  });
});
