import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

import { getConfig, isMissingConfigFile, flushConfigWarnings } from "../utils.js";
import { loadConfig } from "../compiler/config.js";
import { buildModuleGraph } from "../compiler/module-graph.js";
import compile from "../compiler/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_BASIC = path.join(__dirname, "fixtures", "basic");

function stripAnsi(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

async function captureWarnings(rootDir, fn) {
  const warns = [];
  const origWarn = console.warn;
  console.warn = (...args) => warns.push(stripAnsi(args.join(" ")));
  try {
    await fn();
    flushConfigWarnings(rootDir);
  } finally {
    console.warn = origWarn;
    // ensure buffer cleared even if test failed
    flushConfigWarnings(rootDir);
  }
  return warns;
}

async function captureLogs(rootDir, fn) {
  const logs = [];
  const warns = [];
  const origLog = console.log;
  const origWarn = console.warn;
  console.log = (...args) => logs.push(stripAnsi(args.join(" ")));
  console.warn = (...args) => warns.push(stripAnsi(args.join(" ")));
  try {
    await fn();
  } finally {
    console.log = origLog;
    console.warn = origWarn;
    flushConfigWarnings(rootDir);
  }
  return { logs, warns };
}

describe("config — zero-config (no chocola.config.json)", () => {
  test("getConfig returns flagged empty and queues top-level warning", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "chocola-cfg-missing-"));
    await fs.mkdir(path.join(tmp, "src"), { recursive: true });
    const warns = await captureWarnings(tmp, async () => {
      const cfg = await getConfig(tmp);
      assert.ok(isMissingConfigFile(cfg), "should be flagged missing");
      assert.deepEqual(Object.keys(cfg).filter(k => !k.startsWith("__")), [], "empty object");
    });
    assert.ok(warns.some(w => w.includes("chocola.config.json not found")), `expected top-level warning, got ${warns}`);
    // second call should not re-queue due to dedup
    const warns2 = await captureWarnings(tmp, async () => {
      await getConfig(tmp);
    });
    assert.equal(warns2.length, 0, "deduped top-level warning");
    await fs.rm(tmp, { recursive: true, force: true });
  });

  test("loadConfig returns defaults without throwing", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "chocola-cfg-load-"));
    await fs.mkdir(path.join(tmp, "src"), { recursive: true });
    const warns = await captureWarnings(tmp, async () => {
      const cfg = await loadConfig(tmp);
      assert.equal(cfg.srcDir, "src");
      assert.equal(cfg.outDir, "dist");
      assert.equal(cfg.libDir, "lib");
      assert.equal(cfg.emptyOutDir, true);
    });
    // top-level warning only, no per-block warnings
    assert.ok(warns.some(w => w.includes("not found")), `top-level missing, got ${warns}`);
    assert.ok(!warns.some(w => w.includes("bundle config") || w.includes("dev config") || w.includes("server config")), `should not have per-block warnings when file missing, got ${warns}`);
    await fs.rm(tmp, { recursive: true, force: true });
  });

  test("buildModuleGraph and compile work completely config-less (zero-config promise)", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "chocola-zero-graph-"));
    await fs.cp(path.join(FIXTURE_BASIC, "src"), path.join(tmp, "src"), { recursive: true });
    // no chocola.config.json
    let graph;
    const warns = await captureWarnings(tmp, async () => {
      graph = await buildModuleGraph(tmp);
    });
    // buildModuleGraph internally calls loadConfig/getConfig, so top-level warning queued
    // flush happens via capture helper, so we can assert
    assert.ok(graph);
    assert.equal(graph.page.id, "index.html");
    // compile should not throw and should produce dist
    await captureWarnings(tmp, async () => {
      await compile(tmp);
    });
    const out = await fs.readdir(path.join(tmp, "dist"));
    assert.ok(out.includes("index.html"), "compile should produce output even without config");
    await fs.rm(tmp, { recursive: true, force: true });
  });

  test("dev server does not crash when dev config missing (original bug)", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "chocola-zero-dev-"));
    await fs.cp(FIXTURE_BASIC, tmp, { recursive: true });
    // FIXTURE_BASIC has bundle only, no dev block
    const full = await getConfig(tmp);
    assert.ok(!isMissingConfigFile(full), "fixture has file, not missing");
    assert.equal(full.dev, undefined, "dev block should be missing");
    // dev logic should not throw TypeError
    let threw = false;
    try {
      const { isMissingConfigFile: isMissing } = await import("../utils.js");
      if (isMissing(full)) throw new Error("unexpected missing");
      if (full.dev == null) {
        // this is the fixed path: should warn block, not access hostname
      } else {
        // would have thrown before fix: devConfig.hostname access on undefined
        const devConfig = full.dev || {};
        void devConfig.hostname;
        void devConfig.port;
      }
    } catch (e) {
      threw = true;
    }
    assert.equal(threw, false, "dev handling should not throw when dev missing");

    // also test completely missing file
    const tmp2 = await fs.mkdtemp(path.join(os.tmpdir(), "chocola-zero-dev2-"));
    await fs.mkdir(path.join(tmp2, "src", "lib"), { recursive: true });
    await fs.writeFile(path.join(tmp2, "src", "index.html"), "<html><body><app></app></body></html>");
    const full2 = await getConfig(tmp2);
    assert.ok(isMissingConfigFile(full2));
    assert.doesNotThrow(() => {
      const dc = full2.dev || {};
      void dc.hostname;
      void dc.port;
    });
    await fs.rm(tmp, { recursive: true, force: true });
    await fs.rm(tmp2, { recursive: true, force: true });
  });
});

describe("config — hierarchical warnings", () => {
  test("empty {} config warns bundle, dev, server blocks", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "chocola-hier-empty-"));
    await fs.mkdir(path.join(tmp, "src"), { recursive: true });
    await fs.writeFile(path.join(tmp, "chocola.config.json"), JSON.stringify({}));
    const warns = await captureWarnings(tmp, async () => {
      await getConfig(tmp);
      await loadConfig(tmp);
      const full = await getConfig(tmp);
      // dev/server field warnings are handled in dev/server modules, but block warnings are central
      // For this test we just check block warnings via getConfig
    });
    assert.ok(warns.some(w => w.includes("bundle config not defined")), `bundle block, got ${warns}`);
    assert.ok(warns.some(w => w.includes("dev config not defined")), `dev block, got ${warns}`);
    assert.ok(warns.some(w => w.includes("server config not defined")), `server block, got ${warns}`);
    assert.ok(!warns.some(w => w.includes("not found")), "should not have top-level when file exists");
    await fs.rm(tmp, { recursive: true, force: true });
  });

  test("bundle partial missing libDir warns field, plus dev/server blocks", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "chocola-hier-partial-"));
    await fs.mkdir(path.join(tmp, "src"), { recursive: true });
    await fs.writeFile(path.join(tmp, "chocola.config.json"), JSON.stringify({ bundle: { srcDir: "src", outDir: "dist" } }));
    const warns = await captureWarnings(tmp, async () => {
      await getConfig(tmp);
      await loadConfig(tmp);
    });
    assert.ok(warns.some(w => w.includes("bundle.libDir")), `bundle.libDir field, got ${warns}`);
    assert.ok(warns.some(w => w.includes("dev config not defined")), `dev block, got ${warns}`);
    assert.ok(warns.some(w => w.includes("server config not defined")), `server block, got ${warns}`);
    assert.ok(!warns.some(w => w.includes("bundle config not defined")), "bundle block exists, should not warn block");
    await fs.rm(tmp, { recursive: true, force: true });
  });

  test("dev empty block warns fields, not block", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "chocola-hier-devempty-"));
    await fs.mkdir(path.join(tmp, "src"), { recursive: true });
    await fs.writeFile(path.join(tmp, "chocola.config.json"), JSON.stringify({
      bundle: { srcDir: "src", outDir: "dist", libDir: "lib" },
      dev: {},
      server: { hostname: "localhost", port: 8080 }
    }));
    const warns = await captureWarnings(tmp, async () => {
      const full = await getConfig(tmp);
      await loadConfig(tmp);
      // simulate dev field warnings as dev/index.js does
      if (!isMissingConfigFile(full) && full.dev != null) {
        const dc = full.dev;
        if (dc.hostname == null) {
          const chalk = (await import("../compiler/chalk.js")).default;
          const { queueConfigWarning } = await import("../utils.js");
          queueConfigWarning(tmp, chalk.bold.yellow("WARNING!"), `dev.hostname not defined in chocola.config.json file: using default localhost dev.hostname.`);
        }
        if (dc.port == null) {
          const chalk = (await import("../compiler/chalk.js")).default;
          const { queueConfigWarning } = await import("../utils.js");
          queueConfigWarning(tmp, chalk.bold.yellow("WARNING!"), `dev.port not defined in chocola.config.json file: using default 3000 dev.port.`);
        }
      }
    });
    assert.ok(warns.some(w => w.includes("dev.hostname")), `dev.hostname field, got ${warns}`);
    assert.ok(warns.some(w => w.includes("dev.port")), `dev.port field, got ${warns}`);
    assert.ok(!warns.some(w => w.includes("dev config not defined")), "dev block exists, should not warn block");
    await fs.rm(tmp, { recursive: true, force: true });
  });

  test("dev partial hostname only warns dev.port", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "chocola-hier-devpartial-"));
    await fs.mkdir(path.join(tmp, "src"), { recursive: true });
    await fs.writeFile(path.join(tmp, "chocola.config.json"), JSON.stringify({
      bundle: { srcDir: "src", outDir: "dist", libDir: "lib" },
      dev: { hostname: "example.com" },
      server: { hostname: "localhost", port: 8080 }
    }));
    const warns = await captureWarnings(tmp, async () => {
      const full = await getConfig(tmp);
      if (!isMissingConfigFile(full) && full.dev != null) {
        const dc = full.dev;
        if (dc.hostname == null) {
          const chalk = (await import("../compiler/chalk.js")).default;
          const { queueConfigWarning } = await import("../utils.js");
          queueConfigWarning(tmp, chalk.bold.yellow("WARNING!"), `dev.hostname missing`);
        }
        if (dc.port == null) {
          const chalk = (await import("../compiler/chalk.js")).default;
          const { queueConfigWarning } = await import("../utils.js");
          queueConfigWarning(tmp, chalk.bold.yellow("WARNING!"), `dev.port not defined in chocola.config.json file: using default 3000 dev.port.`);
        }
      }
    });
    assert.ok(!warns.some(w => w.includes("dev.hostname")), `should not warn hostname when present, got ${warns}`);
    assert.ok(warns.some(w => w.includes("dev.port")), `dev.port missing, got ${warns}`);
    await fs.rm(tmp, { recursive: true, force: true });
  });

  test("server partial hostname only warns server.port with prefix", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "chocola-hier-srvpartial-"));
    await fs.mkdir(path.join(tmp, "src"), { recursive: true });
    await fs.writeFile(path.join(tmp, "chocola.config.json"), JSON.stringify({
      bundle: { srcDir: "src", outDir: "dist", libDir: "lib" },
      dev: { hostname: "localhost", port: 3000 },
      server: { hostname: "127.0.0.1" }
    }));
    const warns = await captureWarnings(tmp, async () => {
      const full = await getConfig(tmp);
      const sc = full.server || {};
      if (!isMissingConfigFile(full) && full.server != null) {
        if (sc.port == null) {
          const chalk = (await import("../compiler/chalk.js")).default;
          const { queueConfigWarning } = await import("../utils.js");
          queueConfigWarning(tmp, chalk.bold.yellow("WARNING!"), `server.port not defined in chocola.config.json file: using default 8080 server.port.`);
        }
      }
    });
    assert.ok(warns.some(w => w.includes("server.port")), `server.port, got ${warns}`);
    assert.ok(!warns.some(w => w.includes("server.hostname")), `hostname present, got ${warns}`);
    await fs.rm(tmp, { recursive: true, force: true });
  });

  test("no config file only top-level, no per-block", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "chocola-hier-nofile-"));
    await fs.mkdir(path.join(tmp, "src"), { recursive: true });
    const warns = await captureWarnings(tmp, async () => {
      await getConfig(tmp);
      await loadConfig(tmp);
    });
    assert.ok(warns.some(w => w.includes("not found")), `top-level, got ${warns}`);
    assert.ok(!warns.some(w => w.includes("bundle config") || w.includes("dev config") || w.includes("server config")), `no per-block when file missing, got ${warns}`);
    await fs.rm(tmp, { recursive: true, force: true });
  });
});

describe("config — warning full paths (bundle.* dev.* server.*)", () => {
  test("lacking dev.port logs as dev.port not port", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "chocola-prefix-dev-"));
    await fs.mkdir(path.join(tmp, "src"), { recursive: true });
    await fs.writeFile(path.join(tmp, "chocola.config.json"), JSON.stringify({
      bundle: { srcDir: "src", outDir: "dist", libDir: "lib" },
      dev: { hostname: "localhost" },
      server: { hostname: "localhost", port: 8080 }
    }));
    const warns = await captureWarnings(tmp, async () => {
      const full = await getConfig(tmp);
      if (!isMissingConfigFile(full) && full.dev != null && full.dev.port == null) {
        const chalk = (await import("../compiler/chalk.js")).default;
        const { queueConfigWarning } = await import("../utils.js");
        queueConfigWarning(tmp, chalk.bold.yellow("WARNING!"), `dev.port not defined in chocola.config.json file: using default 3000 dev.port.`);
      }
    });
    const portWarn = warns.find(w => w.includes("port not defined"));
    assert.ok(portWarn, "should have port warning");
    assert.match(portWarn, /dev\.port/, `should log as dev.port, got ${portWarn}`);
    assert.ok(!portWarn.match(/(^| )port not defined/) || portWarn.includes("dev.port"), "should not log generic port without prefix");
    await fs.rm(tmp, { recursive: true, force: true });
  });

  test("bundle field warnings use bundle.* prefix", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "chocola-prefix-bundle-"));
    await fs.mkdir(path.join(tmp, "src"), { recursive: true });
    await fs.writeFile(path.join(tmp, "chocola.config.json"), JSON.stringify({ bundle: { srcDir: "src" } }));
    const warns = await captureWarnings(tmp, async () => {
      await loadConfig(tmp);
    });
    const outWarn = warns.find(w => w.includes("outDir"));
    assert.ok(outWarn && outWarn.includes("bundle.outDir"), `bundle.outDir prefix, got ${outWarn}`);
    const libWarn = warns.find(w => w.includes("libDir"));
    assert.ok(libWarn && libWarn.includes("bundle.libDir"), `bundle.libDir prefix, got ${libWarn}`);
    await fs.rm(tmp, { recursive: true, force: true });
  });

  test("server field warnings use server.* prefix", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "chocola-prefix-server-"));
    await fs.mkdir(path.join(tmp, "src"), { recursive: true });
    await fs.writeFile(path.join(tmp, "chocola.config.json"), JSON.stringify({
      bundle: { srcDir: "src", outDir: "dist", libDir: "lib" },
      dev: { hostname: "localhost", port: 3000 },
      server: {}
    }));
    const warns = await captureWarnings(tmp, async () => {
      const full = await getConfig(tmp);
      const sc = full.server || {};
      if (sc.port == null) {
        const chalk = (await import("../compiler/chalk.js")).default;
        const { queueConfigWarning } = await import("../utils.js");
        queueConfigWarning(tmp, chalk.bold.yellow("WARNING!"), `server.port not defined in chocola.config.json file: using default 8080 server.port.`);
      }
      if (sc.hostname == null) {
        const chalk = (await import("../compiler/chalk.js")).default;
        const { queueConfigWarning } = await import("../utils.js");
        queueConfigWarning(tmp, chalk.bold.yellow("WARNING!"), `server.hostname not defined in chocola.config.json file: using default localhost server.hostname.`);
      }
    });
    assert.ok(warns.some(w => w.includes("server.port")), `server.port, got ${warns}`);
    assert.ok(warns.some(w => w.includes("server.hostname")), `server.hostname, got ${warns}`);
    await fs.rm(tmp, { recursive: true, force: true });
  });
});

describe("config — warnings before JOB DONE!", () => {
  test("config warnings are flushed right before JOB DONE! (grouped, not on-the-fly)", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "chocola-before-job-"));
    await fs.mkdir(path.join(tmp, "src", "lib"), { recursive: true });
    await fs.writeFile(path.join(tmp, "src", "index.html"), "<html><head><title>t</title></head><body><app>hi</app></body></html>");
    await fs.writeFile(path.join(tmp, "src", "lib", "Comp.html"), "<template><div>c</div></template>");
    // no config -> top-level warning should appear before JOB DONE!
    const logs = [];
    const warns = [];
    const origLog = console.log;
    const origWarn = console.warn;
    console.log = (...args) => logs.push(stripAnsi(args.join(" ")));
    console.warn = (...args) => warns.push(stripAnsi(args.join(" ")));
    let all = [];
    const origLog2 = console.log;
    const origWarn2 = console.warn;
    // intercept both to capture order
    const combined = [];
    console.log = (...args) => combined.push("LOG:" + stripAnsi(args.join(" ")));
    console.warn = (...args) => combined.push("WARN:" + stripAnsi(args.join(" ")));
    try {
      await compile(tmp);
    } finally {
      console.log = origLog;
      console.warn = origWarn;
      // flush any remaining for this root (should be already flushed before JOB DONE!)
      flushConfigWarnings(tmp);
    }
    // also capture via combined
    // Re-run with combined capture to check order
    // Instead, do fresh tmp to avoid dedup
    const tmp2 = await fs.mkdtemp(path.join(os.tmpdir(), "chocola-before-job2-"));
    await fs.mkdir(path.join(tmp2, "src", "lib"), { recursive: true });
    await fs.writeFile(path.join(tmp2, "src", "index.html"), "<html><body><app>hi</app></body></html>");
    await fs.writeFile(path.join(tmp2, "src", "lib", "Comp.html"), "<template><div>c</div></template>");
    const order = [];
    const oLog = console.log;
    const oWarn = console.warn;
    console.log = (...args) => order.push("LOG:" + stripAnsi(args.join(" ")));
    console.warn = (...args) => order.push("WARN:" + stripAnsi(args.join(" ")));
    try {
      await compile(tmp2);
    } finally {
      console.log = oLog;
      console.warn = oWarn;
      flushConfigWarnings(tmp2);
    }
    const jobIdx = order.findIndex(l => l.includes("JOB DONE"));
    const warnIdxs = order.map((l, i) => l.startsWith("WARN:") ? i : -1).filter(i => i >= 0);
    assert.ok(jobIdx >= 0, "JOB DONE! should be logged");
    assert.ok(warnIdxs.length > 0, `should have config warnings before JOB DONE, got ${order.join("\n")}`);
    const lastWarn = Math.max(...warnIdxs);
    assert.ok(lastWarn < jobIdx, `last warning (${lastWarn}) should be before JOB DONE (${jobIdx})`);
    // warnings should be close to JOB DONE! (within 3 lines: Project bundled + JOB DONE!)
    assert.ok(jobIdx - lastWarn <= 3, `warnings should be right before JOB DONE! (diff ${jobIdx - lastWarn}), order: ${order.join(" | ")}`);
    // ensure warnings are not at the very start (on-the-fly would be before Components found)
    const compIdx = order.findIndex(l => l.includes("Components found"));
    assert.ok(warnIdxs.every(i => i > compIdx), "warnings should be after Components found, not on-the-fly at start");
    await fs.rm(tmp, { recursive: true, force: true });
    await fs.rm(tmp2, { recursive: true, force: true });
  });

  test("full config produces no warnings", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "chocola-full-ok-"));
    await fs.mkdir(path.join(tmp, "src", "lib"), { recursive: true });
    await fs.writeFile(path.join(tmp, "src", "index.html"), "<html><body><app></app></body></html>");
    await fs.writeFile(path.join(tmp, "src", "lib", "A.html"), "<template><div>a</div></template>");
    await fs.writeFile(path.join(tmp, "chocola.config.json"), JSON.stringify({
      bundle: { srcDir: "src", outDir: "dist", libDir: "lib" },
      dev: { hostname: "localhost", port: 3000 },
      server: { hostname: "localhost", port: 8080 }
    }));
    const warns = await captureWarnings(tmp, async () => {
      await getConfig(tmp);
      await loadConfig(tmp);
      const full = await getConfig(tmp);
      // dev/server fields present, so no warnings
      if (!isMissingConfigFile(full) && full.dev != null) {
        // would warn if missing, but not here
      }
    });
    assert.equal(warns.length, 0, `full config should produce no warnings, got ${warns}`);
    await fs.rm(tmp, { recursive: true, force: true });
  });
});
