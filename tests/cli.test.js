import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "child_process";
import { promises as fsp, existsSync } from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(__dirname, "..", "bin", "chocola.js");
const FIXTURE_BASIC = path.join(__dirname, "fixtures", "basic");

function stripAnsi(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function run(args, opts = {}) {
  const env = { ...process.env, ...(opts.env || {}) };
  const r = spawnSync("node", [CLI, ...args], {
    cwd: opts.cwd || process.cwd(),
    encoding: "utf-8",
    timeout: 15000,
    env,
  });
  return {
    status: r.status,
    stdout: stripAnsi(r.stdout || ""),
    stderr: stripAnsi(r.stderr || ""),
  };
}

async function makeZeroConfigFixture() {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "chocola-cli-"));
  const srcDir = path.join(tmp, "src");
  await fsp.mkdir(srcDir, { recursive: true });
  await fsp.writeFile(path.join(srcDir, "index.html"), "<html><body><app>Hello</app></body></html>");
  await fsp.mkdir(path.join(srcDir, "lib"), { recursive: true });
  await fsp.writeFile(path.join(srcDir, "lib", "hello.html"), "<html><body><app>Hello</app></body></html>");
  await fsp.mkdir(path.join(srcDir, "static"), { recursive: true });
  await fsp.writeFile(path.join(srcDir, "static", "favicon.ico"), "icon");
  return tmp;
}

async function makeAltConfig() {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "chocola-alt-"));
  const srcDir = path.join(tmp, "src");
  await fsp.mkdir(srcDir, { recursive: true });
  await fsp.writeFile(path.join(srcDir, "index.html"), "<html><body><app>Hello</app></body></html>");
  await fsp.mkdir(path.join(srcDir, "lib"), { recursive: true });
  await fsp.writeFile(path.join(srcDir, "lib", "hello.html"), "<html><body><app>Hello</app></body></html>");
  await fsp.mkdir(path.join(srcDir, "static"), { recursive: true });
  await fsp.writeFile(path.join(srcDir, "static", "favicon.ico"), "icon");
  await fsp.writeFile(path.join(tmp, "alt.json"), JSON.stringify({ bundle: { srcDir: "src", outDir: "alt_out" } }));
  return tmp;
}

describe("cli — build", () => {
  test("build creates dist/index.html without init scripts", () => {
    const r = run(["build", FIXTURE_BASIC]);
    assert.strictEqual(r.status, 0);
    assert.ok(existsSync(path.join(FIXTURE_BASIC, "dist", "index.html")));
  });

  test("--outDir flag respected", async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "chocola-outdir-"));
    const srcDir = path.join(tmp, "src");
    await fsp.mkdir(srcDir, { recursive: true });
    await fsp.writeFile(path.join(srcDir, "index.html"), "<html><body><app>Hello</app></body></html>");
    await fsp.mkdir(path.join(srcDir, "lib"), { recursive: true });
    await fsp.writeFile(path.join(srcDir, "lib", "hello.html"), "<html><body><app>Hello</app></body></html>");
    await fsp.mkdir(path.join(srcDir, "static"), { recursive: true });
    await fsp.writeFile(path.join(srcDir, "static", "favicon.ico"), "icon");

    const outDir = path.join(tmp, "my_out");
    const r = run(["build", tmp, "--outDir", outDir]);
    assert.strictEqual(r.status, 0);
    assert.ok(existsSync(path.join(outDir, "index.html")));
    await fsp.rm(tmp, { recursive: true, force: true });
  });

  test("build works with zero config (no chocola.config.json)", async () => {
    const tmp = await makeZeroConfigFixture();
    const r = run(["build", tmp]);
    assert.strictEqual(r.status, 0);
    assert.ok(existsSync(path.join(tmp, "dist", "index.html")));
    await fsp.rm(tmp, { recursive: true, force: true });
  });

  test("missing config produces no WARNING! lines", async () => {
    const tmp = await makeZeroConfigFixture();
    const r = run(["build", tmp]);
    assert.strictEqual(r.status, 0);
    assert.ok(!r.stderr.includes("WARNING!"), `Expected no warnings but got: ${r.stderr}`);
    await fsp.rm(tmp, { recursive: true, force: true });
  });

  test("--help exits 0", () => {
    const r = run(["--help"]);
    assert.strictEqual(r.status, 0);
    assert.ok(r.stdout.includes("chocola <command>"));
  });

  test("--version exits 0", async () => {
    const r = run(["--version"]);
    assert.strictEqual(r.status, 0);
    const pkg = JSON.parse(await fsp.readFile(path.join(__dirname, "..", "package.json"), "utf-8"));
    assert.ok(r.stdout.includes(pkg.version));
  });
});

describe("cli — dev and serve", () => {
  test("dev stays alive with --port flag", () => {
    const r = spawnSync("node", [CLI, "dev", FIXTURE_BASIC, "--port", "3555"], {
      cwd: process.cwd(),
      encoding: "utf-8",
      timeout: 3000,
    });
    assert.strictEqual(r.status, null);
  });

  test("serve stays alive with PORT env override", () => {
    const r = spawnSync("node", [CLI, "serve", FIXTURE_BASIC], {
      cwd: process.cwd(),
      encoding: "utf-8",
      timeout: 3000,
      env: { ...process.env, PORT: "3556" },
    });
    assert.strictEqual(r.status, null);
  });
});

describe("cli — --config precedence", () => {
  test("--config ./alt.json picks alt config", async () => {
    const tmp = await makeAltConfig();
    const altPath = path.join(tmp, "alt.json");
    const r = run(["build", tmp, "--config", altPath]);
    assert.strictEqual(r.status, 0);
    assert.ok(existsSync(path.join(tmp, "alt_out", "index.html")), `Expected alt_out/index.html, stdout: ${r.stdout}, stderr: ${r.stderr}`);
    await fsp.rm(tmp, { recursive: true, force: true });
  });

  test("--config with missing path throws ENOENT", () => {
    const r = run(["build", FIXTURE_BASIC, "--config", "nonexistent.json"]);
    assert.strictEqual(r.status, 1);
    assert.ok(r.stderr.includes("ENOENT") || r.stderr.includes("not found"), `Expected ENOENT error, got: ${r.stderr}`);
  });
});

describe("cli — chjs alias and bad args", () => {
  test("--version exits 0", async () => {
    const r = spawnSync("node", [CLI, "--version"], {
      cwd: process.cwd(),
      encoding: "utf-8",
      timeout: 5000,
    });
    assert.strictEqual(r.status, 0);
    const pkg = JSON.parse(await fsp.readFile(path.join(__dirname, "..", "package.json"), "utf-8"));
    assert.ok(r.stdout.includes(pkg.version));
  });

  test("unknown command exits 2", () => {
    const r = run(["badcommand"]);
    assert.strictEqual(r.status, 2);
  });
});
