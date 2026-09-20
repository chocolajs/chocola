#!/usr/bin/env node
import path from "path";
import { fileURLToPath } from "url";
import { readFile } from "fs/promises";
import { getConfig, isMissingConfigFile } from "../utils.js";
import { loadConfig } from "../compiler/config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default __dirname;

export async function resolveConfig(rootDir, cliOverrides, configPathOpt) {
  const customPath = configPathOpt ? path.resolve(rootDir, configPathOpt) : null;
  const fullConfig = customPath
    ? await readFile(customPath, "utf-8").then(r => JSON.parse(r))
    : await getConfig(rootDir, { silent: true });
  const isMissing = customPath ? false : isMissingConfigFile(fullConfig);
  const base = await loadConfig(rootDir, { silent: true, customPath });
  if (cliOverrides.outDir) base.outDir = cliOverrides.outDir;
  if (cliOverrides.srcDir) base.srcDir = cliOverrides.srcDir;
  if (cliOverrides.libDir) base.libDir = cliOverrides.libDir;
  if (cliOverrides.emptyOutDir != null) base.emptyOutDir = cliOverrides.emptyOutDir;
  const effectiveDev = { hostname: "localhost", port: 3000, ...(!isMissing && fullConfig.dev || {}), ...cliOverrides.dev };
  const effectiveServer = { hostname: "localhost", port: 8080, middleware: null, ...(!isMissing && fullConfig.server || {}), ...cliOverrides.server };
  if (!cliOverrides.server?.port && process.env.PORT) {
    const envPort = parseInt(process.env.PORT, 10);
    if (Number.isFinite(envPort)) effectiveServer.port = envPort;
  }
  if (!cliOverrides.server?.hostname && !fullConfig.server?.hostname && !fullConfig.server?.host && process.env.PORT) {
    effectiveServer.hostname = "0.0.0.0";
  }
  return { fullConfig, base, effectiveDev, effectiveServer, isMissing };
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const cmd = args[0];
  if (!cmd || cmd === "--help" || cmd === "-h") return { cmd: "help", rest: [] };
  if (cmd === "--version" || cmd === "-v") return { cmd: "version", rest: [] };
  const positional = [];
  const flags = {};
  let configPath = null;
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--config" || arg === "-c") {
      configPath = args[++i];
    } else if (arg.startsWith("--")) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
        flags[key] = args[++i];
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  return { cmd, root: positional[0] || undefined, flags, configPath, rest: args };
}

export async function main() {
  const { cmd, root, flags, configPath } = parseArgs(process.argv);

  if (cmd === "help") {
    console.log("Usage: chocola <command> [root] [options]");
    console.log("Commands: build, dev, serve");
    return;
  }
  if (cmd === "version") {
    const pkg = await readFile(path.join(__dirname, "../package.json"), "utf-8");
    console.log(JSON.parse(pkg).version);
    return;
  }

  const rootDir = path.resolve(root || process.cwd());

  if (configPath) {
    await readFile(path.resolve(rootDir, configPath), "utf-8");
  }

  const effectiveDevPort = flags.port ? parseInt(flags.port, 10) : undefined;
  const effectiveHost = flags.host || flags.hostname;

  const { effectiveDev, effectiveServer } = await resolveConfig(rootDir, {
    outDir: flags.outDir,
    srcDir: flags.srcDir,
    libDir: flags.libDir,
    emptyOutDir: flags.emptyOutDir === false ? false : (flags.noEmptyOutDir === true ? false : undefined),
    dev: { port: effectiveDevPort, hostname: effectiveHost },
    server: { port: effectiveDevPort, hostname: effectiveHost },
  }, configPath);

  switch (cmd) {
    case "build": {
      const { compile } = await import("../compiler/index.js");
      await compile(rootDir, { overrides: { srcDir: flags.srcDir, outDir: flags.outDir, libDir: flags.libDir, emptyOutDir: flags.emptyOutDir === false ? false : undefined } });
      break;
    }
    case "dev": {
      const { serve: devServe } = await import("../dev/index.js");
      await devServe(rootDir, {
        port: effectiveDevPort || effectiveDev.port,
        hostname: effectiveHost || effectiveDev.hostname,
        open: flags.open || false,
        silent: true,
      });
      break;
    }
    case "serve": {
      const { serve: serverServe } = await import("../server/index.js");
      await serverServe(rootDir, {
        port: effectiveDevPort || effectiveServer.port,
        hostname: effectiveHost || effectiveServer.hostname,
        middleware: flags.middleware || null,
        silent: true,
      });
      break;
    }
    default:
      console.error(`Unknown command: ${cmd}`);
      process.exit(2);
  }
}
