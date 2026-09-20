#!/usr/bin/env node
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { createRequire } from "module";
import { readFile } from "fs/promises";
import { getConfig, isMissingConfigFile } from "../utils.js";
import { loadConfig } from "../compiler/config.js";

import chalk from "../compiler/chalk.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isPlain = process.env.NO_COLOR === "1" || process.argv.includes("--plain");
const c = isPlain ? {
  hex: () => (s) => s, bold: (s) => s, green: (s) => s, yellow: (s) => s, red: (s) => s, underline: (s) => s,
} : chalk;

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

function parsePort(val) {
  const n = parseInt(val, 10);
  if (Number.isNaN(n) || n < 1 || n > 65535) {
    throw new Error(`Invalid port: ${val}. Must be between 1 and 65535.`);
  }
  return n;
}

function kebabToCamel(str) {
  return str.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

export function parseArgs(argv) {
  const args = argv.slice(2).filter(a => a !== "--plain");
  const cmd = args[0];
  if (!cmd || cmd === "--help" || cmd === "-h") return { cmd: "help", rest: [] };
  if (cmd === "--version" || cmd === "-v") return { cmd: "version", rest: [] };
  const positional = [];
  const flags = {};
  let configPath = null;
  let i = 1;
  while (i < args.length) {
    const arg = args[i];
    if (arg === "--config" || arg === "-c") {
      configPath = args[++i];
    } else if (arg.startsWith("--")) {
      const key = kebabToCamel(arg.slice(2));
      if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
        flags[key] = args[++i];
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
    i++;
  }
  return { cmd, root: positional[0] || undefined, flags, configPath, rest: args };
}

async function getLocalModules(rootDir) {
  try {
    const req = createRequire(pathToFileURL(path.join(rootDir, "package.json")).href);
    const localPkgPath = req.resolve("chocola/package.json");
    const localRoot = path.dirname(localPkgPath);
    const cliDir = path.dirname(path.dirname(__filename));
    if (localRoot === cliDir) return null;
    const mod = await import(pathToFileURL(path.join(localRoot, "compiler/index.js")).href);
    return { rootDir: localRoot, mod };
  } catch { return null; }
}

async function banner() {
  if (!isPlain) {
    const { logBanner } = await import("../compiler/index.js");
    logBanner();
  }
}

export async function main() {
  const { cmd, root, flags, configPath } = parseArgs(process.argv);

  if (cmd === "help") {
    await banner();
    console.log(c.bold("Usage: ") + "chocola <command> [root] [options]");
    console.log("");
    console.log("Commands:");
    console.log("  build   Build for production");
    console.log("  dev     Start dev server with hot-reload");
    console.log("  serve   Start SSR production server");
    console.log("");
    console.log("Options:");
    console.log("  -c, --config <path>   Path to config file");
    console.log("  --help, -h            Show help");
    console.log("  --version, -v         Show version");
    console.log("  --plain, NO_COLOR=1   Disable color output");
    console.log("");
    console.log("build options:");
    console.log("  --srcDir <dir>        Source directory (default: src)");
    console.log("  --outDir <dir>        Output directory (default: dist)");
    console.log("  --libDir <dir>        Components subdir (default: lib)");
    console.log("  --no-emptyOutDir      Do not clean outDir before build");
    console.log("");
    console.log("dev options:");
    console.log("  --host <hostname>     Hostname (default: localhost)");
    console.log("  --port <number>       Port (default: 3000)");
    console.log("  --open                Open browser after start");
    console.log("");
    console.log("serve options:");
    console.log("  --host <hostname>     Hostname (default: localhost)");
    console.log("  --port <number>       Port (default: 8080)");
    console.log("  --middleware <path>   Path to middleware file");
    return;
  }
  if (cmd === "version") {
    const pkg = await readFile(path.join(__dirname, "../package.json"), "utf-8");
    console.log(JSON.parse(pkg).version);
    return;
  }

  if (!["build", "dev", "serve"].includes(cmd)) {
    console.error(c.red(`Unknown command: ${cmd}. Use "chocola --help" for usage.`));
    process.exit(2);
  }

  const rootDir = path.resolve(root || process.cwd());

  try {
    if (configPath) {
      await readFile(path.resolve(rootDir, configPath), "utf-8");
    }
    const rawPort = flags.port ? parsePort(flags.port) : undefined;
    const effectiveHost = flags.host || flags.hostname;

    const { base, effectiveDev, effectiveServer } = await resolveConfig(rootDir, {
      outDir: flags.outDir,
      srcDir: flags.srcDir,
      libDir: flags.libDir,
      emptyOutDir: flags.emptyOutDir === false ? false : (flags.noEmptyOutDir === true ? false : undefined),
      dev: { port: rawPort, hostname: effectiveHost },
      server: { port: rawPort, hostname: effectiveHost },
    }, configPath);

    let serverInstance = null;
    let devServer = null;
    const cleanup = () => {
      if (devServer) { try { devServer.close(); } catch {} }
      if (serverInstance) { try { serverInstance.close(); } catch {} }
      process.exit(0);
    };
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);

    switch (cmd) {
      case "build": {
        const local = await getLocalModules(rootDir);
        const compile = local ? local.mod.default : (await import("../compiler/index.js")).default;
        await compile(rootDir, { overrides: base });
        process.exit(0);
      }
      case "dev": {
        const local = await getLocalModules(rootDir);
        const devMod = local
          ? await import(pathToFileURL(path.join(local.rootDir, "dev/index.js")).href)
          : await import("../dev/index.js");
        const serve = devMod.serve || devMod.default;
        serverInstance = await serve(rootDir, {
          port: rawPort || effectiveDev.port,
          hostname: effectiveHost || effectiveDev.hostname,
          open: flags.open || false,
          silent: true,
        });
        devServer = serverInstance;
        break;
      }
      case "serve": {
        const local = await getLocalModules(rootDir);
        const serverMod = local
          ? await import(pathToFileURL(path.join(local.rootDir, "server/index.js")).href)
          : await import("../server/index.js");
        const serve = serverMod.serve || serverMod.default?.serve;
        serverInstance = await serve(rootDir, {
          port: rawPort || effectiveServer.port,
          hostname: effectiveHost || effectiveServer.hostname,
          middleware: flags.middleware || null,
          silent: true,
        });
      }
    }
  } catch (err) {
    if (err.code === "ENOENT" && configPath) {
      console.error(c.red(`Config file not found: ${path.resolve(rootDir, configPath)}`));
      process.exit(1);
    }
    console.error(c.red(err.message || err));
    process.exit(1);
  }
}

if (process.argv[1] === __filename) {
  main().catch(err => {
    console.error(err.message || err);
    process.exit(1);
  });
}
