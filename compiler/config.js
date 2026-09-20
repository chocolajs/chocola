import path from "path";
import chalk from "./chalk.js";
import { getConfig, isMissingConfigFile, queueConfigWarning } from "../utils.js";

const warnedBundleFields = new Set();

export async function loadConfig(rootDir, { silent, customPath, overrides } = {}) {
  const config = await getConfig(rootDir, { silent });

  if (isMissingConfigFile(config)) {
    return { srcDir: "src", outDir: "dist", libDir: "lib", emptyOutDir: true, treeShakeRuntime: true };
  }

  const hasBundle = (config.bundle !== undefined && config.bundle !== null) || (config.build !== undefined && config.build !== null);

  const bundleConfig = config.bundle || config.build || {};
  const compilerConfig = config.compiler || {};

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

  const srcDir = bundleConfig.srcDir || "src";
  const outDir = bundleConfig.outDir || "dist";
  const libDir = bundleConfig.libDir || "lib";
  const emptyOutDir = bundleConfig.emptyOutDir !== false;
  const treeShakeRuntime = compilerConfig.treeShakeRuntime !== false;

  const result = { srcDir, outDir, libDir, emptyOutDir, treeShakeRuntime };
  if (overrides) {
    Object.assign(result, overrides);
  }
  return result;
}

export function resolvePaths(rootDir, config) {
  return {
    outDir: path.join(rootDir, config.outDir),
    src: path.join(rootDir, config.srcDir),
    components: path.join(rootDir, config.srcDir, config.libDir),
  };
}
