import path from "path";
import { promises as fsp } from "fs";
import chalk from "./chalk.js";
import { getConfig, isMissingConfigFile, queueConfigWarning } from "../utils.js";

const warnedBundleFields = new Set();

export async function loadConfig(rootDir, { silent, customPath, overrides } = {}) {
  const config = customPath
    ? await fsp.readFile(customPath, "utf-8").then(r => JSON.parse(r))
    : await getConfig(rootDir, { silent });

  let srcDir = "src", outDir = "dist", libDir = "lib", emptyOutDir = true, treeShakeRuntime = true;

  if (!customPath || !isMissingConfigFile(config)) {
    const hasBundle = (config.bundle !== undefined && config.bundle !== null) || (config.build !== undefined && config.build !== null);
    const bundleConfig = config.bundle || config.build || {};
    const compilerConfig = config.compiler || {};
    srcDir = bundleConfig.srcDir || "src";
    outDir = bundleConfig.outDir || "dist";
    libDir = bundleConfig.libDir || "lib";
    emptyOutDir = bundleConfig.emptyOutDir !== false;
    treeShakeRuntime = compilerConfig.treeShakeRuntime !== false;

    if (!silent && hasBundle) {
      if (bundleConfig.srcDir == null && !warnedBundleFields.has(rootDir + ":srcDir")) {
        warnedBundleFields.add(rootDir + ":srcDir");
        queueConfigWarning(rootDir, chalk.bold.yellow("WARNING!"), `bundle.srcDir not defined in chocola.config.json file: using default "src" bundle.srcDir.`);
      }
      if (bundleConfig.outDir == null && !warnedBundleFields.has(rootDir + ":outDir")) {
        warnedBundleFields.add(rootDir + ":outDir");
        queueConfigWarning(rootDir, chalk.bold.yellow("WARNING!"), `bundle.outDir not defined in chocola.config.json file: using default "dist" bundle.outDir.`);
      }
      if (bundleConfig.libDir == null && !warnedBundleFields.has(rootDir + ":libDir")) {
        warnedBundleFields.add(rootDir + ":libDir");
        queueConfigWarning(rootDir, chalk.bold.yellow("WARNING!"), `bundle.libDir not defined in chocola.config.json file: using default "lib" bundle.libDir.`);
      }
    }
  }

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
