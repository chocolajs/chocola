import path from "path";
import { getConfig } from "../utils.js";

export async function loadConfig(rootDir) {
  const config = await getConfig(rootDir);
  const bundleConfig = config.bundle || {};

  const srcDir = bundleConfig.srcDir || "src";
  const outDir = bundleConfig.outDir || "dist";
  const libDir = bundleConfig.libDir || "lib";
  const emptyOutDir = bundleConfig.emptyOutDir !== false;

  return { srcDir, outDir, libDir, emptyOutDir };
}

export function resolvePaths(rootDir, config) {
  return {
    outDir: path.join(rootDir, config.outDir),
    src: path.join(rootDir, config.srcDir),
    components: path.join(rootDir, config.srcDir, config.libDir),
  };
}
