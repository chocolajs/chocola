import { promises as fs } from "fs";
import path from "path";
import chalk from "../compiler/chalk.js";
import { throwError } from "../compiler/utils.js";

const warnedMissing = new Set();
const warnedBlockBundle = new Set();
const warnedBlockDev = new Set();
const warnedBlockServer = new Set();

const configWarningBuffers = new Map();

export function queueConfigWarning(rootDir, ...args) {
  if (!configWarningBuffers.has(rootDir)) configWarningBuffers.set(rootDir, []);
  configWarningBuffers.get(rootDir).push(args);
}

export function flushConfigWarnings(rootDir) {
  if (rootDir) {
    const buf = configWarningBuffers.get(rootDir);
    if (!buf || !buf.length) return;
    const toFlush = [...buf];
    buf.length = 0;
    for (const args of toFlush) {
      console.warn(...args);
    }
    return;
  }
  for (const [dir, buf] of configWarningBuffers) {
    if (!buf.length) continue;
    const toFlush = [...buf];
    buf.length = 0;
    for (const args of toFlush) {
      console.warn(...args);
    }
  }
}

export async function getConfig(__rootdir, { silent } = {}) {
    try {
        const raw = await fs.readFile(path.join(__rootdir, "chocola.config.json"), "utf-8");
        const config = JSON.parse(raw);

        const hasBundle = (config.bundle !== undefined && config.bundle !== null) || (config.build !== undefined && config.build !== null);
        const hasDev = config.dev !== undefined && config.dev !== null;
        const hasServer = config.server !== undefined && config.server !== null;

        if (!silent) {
          if (!hasBundle && !warnedBlockBundle.has(__rootdir)) {
              warnedBlockBundle.add(__rootdir);
              queueConfigWarning(__rootdir, chalk.bold.yellow("WARNING!"), "bundle config not defined in chocola.config.json file: using default bundle configuration.");
          }
          if (!hasDev && !warnedBlockDev.has(__rootdir)) {
              warnedBlockDev.add(__rootdir);
              queueConfigWarning(__rootdir, chalk.bold.yellow("WARNING!"), "dev config not defined in chocola.config.json file: using default dev configuration.");
          }
          if (!hasServer && !warnedBlockServer.has(__rootdir)) {
              warnedBlockServer.add(__rootdir);
              queueConfigWarning(__rootdir, chalk.bold.yellow("WARNING!"), "server config not defined in chocola.config.json file: using default server configuration.");
          }
        }

        return config;
    } catch(err) {
        if (err && err.code === "ENOENT") {
            if (!silent && !warnedMissing.has(__rootdir)) {
                warnedMissing.add(__rootdir);
                queueConfigWarning(__rootdir, chalk.bold.yellow("WARNING!"), "chocola.config.json not found: using default configuration.");
            }
            const empty = {};
            Object.defineProperty(empty, "__chocolaMissingConfigFile", { value: true, enumerable: false, writable: false });
            return empty;
        }
        throwError("An error occurred while fetching the Chocola config file:\n" + err);
    }
}

export function isMissingConfigFile(cfg) {
    return !!(cfg && cfg.__chocolaMissingConfigFile);
}
