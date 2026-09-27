import path from "path";
import { promises as fsp } from "fs";

export async function loadConfig(rootDir, { silent, customPath, overrides } = {}) {
  let config;
  try {
    const raw = customPath
      ? await fsp.readFile(customPath, "utf-8").then(r => JSON.parse(r))
      : await fsp.readFile(path.join(rootDir, "chocola.config.json"), "utf-8").then(r => JSON.parse(r));
    config = raw;
  } catch {
    if (!silent) {
      // Config file missing — silently use defaults
    }
    config = {};
  }

  let srcDir = "src", outDir = "dist", libDir = "lib", emptyOutDir = true, treeShakeRuntime = true;

  const hasBundle = (config.bundle !== undefined && config.bundle !== null) || (config.build !== undefined && config.build !== null);
  const bundleConfig = config.bundle || config.build || {};
  const compilerConfig = config.compiler || {};
  srcDir = bundleConfig.srcDir || "src";
  outDir = bundleConfig.outDir || "dist";
  libDir = bundleConfig.libDir || "lib";
  emptyOutDir = bundleConfig.emptyOutDir !== false;
  treeShakeRuntime = compilerConfig.treeShakeRuntime !== false;

  const result = { srcDir, outDir, libDir, emptyOutDir, treeShakeRuntime };
  if (overrides) { Object.assign(result, overrides); }
  return result;
}

export function resolvePaths(rootDir, config) {
  return {
    outDir: path.isAbsolute(config.outDir) ? config.outDir : path.join(rootDir, config.outDir),
    src: path.isAbsolute(config.srcDir) ? config.srcDir : path.join(rootDir, config.srcDir),
    components: path.isAbsolute(config.srcDir) ? path.join(config.srcDir, config.libDir) : path.join(rootDir, config.srcDir, config.libDir),
  };
}
