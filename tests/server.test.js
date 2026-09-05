import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import http from "http";
import zlib from "zlib";
import { fileURLToPath } from "url";

import { createHandler, createServer, serve } from "../server/index.js";
import { deterministicHash } from "../compiler/utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "fixtures", "server");
const FIXTURE_BASIC = path.join(__dirname, "fixtures", "basic");

function httpRequest(baseUrl, pathname, opts = {}) {
  const url = new URL(pathname, baseUrl);
  const headers = opts.headers || {};
  const method = opts.method || "GET";
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks);
        const encoding = res.headers["content-encoding"];
        let body = raw;
        if (encoding === "gzip" && raw.length) {
          try {
            body = zlib.gunzipSync(raw);
          } catch {}
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body,
          text: body.toString("utf-8"),
        });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

describe("server — route table + SSR rendering", () => {
  let tmpParent;
  let tmpRoot;
  let server;
  let baseUrl;

  before(async () => {
    tmpParent = await fs.mkdtemp(path.join(os.tmpdir(), "chocola-server-test-"));
    tmpRoot = path.join(tmpParent, "app");
    await fs.cp(FIXTURE, tmpRoot, { recursive: true });
    const handler = await createHandler(tmpRoot);
    server = http.createServer(handler);
    await new Promise((res, rej) => {
      server.once("error", rej);
      server.listen(0, "127.0.0.1", res);
    });
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    if (server) await new Promise((r) => server.close(r));
    if (tmpParent) await fs.rm(tmpParent, { recursive: true, force: true });
  });

  test("GET / returns rendered index.html with interpolated props, scoped css and hydration scripts", async () => {
    const res = await httpRequest(baseUrl, "/");
    assert.equal(res.status, 200);
    assert.match(res.headers["content-type"], /text\/html/);
    assert.ok(res.headers["etag"], "ETag present");
    assert.ok(res.headers["last-modified"], "Last-Modified present");
    assert.ok(res.text.includes("Hello World!"), "default prop fallback should render World");
    assert.ok(res.text.includes(`class="greeting ${deterministicHash("greeting.html", 8)}"`), "scoped css missing");
    assert.ok(/sc-[a-z]+\.css/.test(res.text), "scoped css link missing");
    assert.ok(/run-[a-z]+\.js/.test(res.text), "runtime hydration scripts missing");
    assert.ok(res.text.includes("slot content"), "slot projection missing");
  });

  test("non-root route from generated table renders same page module", async () => {
    const resRoot = await httpRequest(baseUrl, "/");
    const resIndex = await httpRequest(baseUrl, "/index.html");
    const resIndex2 = await httpRequest(baseUrl, "/index");
    for (const res of [resIndex, resIndex2]) {
      assert.equal(res.status, 200);
      assert.ok(res.text.includes("Hello World!"));
      assert.ok(/sc-[a-z]+\.css/.test(res.text));
    }
    // Ensure they are SSR-rendered, not static files
    assert.ok(resIndex.text.includes(`class="greeting`));
  });

  test("GET /unknown → 404", async () => {
    const res = await httpRequest(baseUrl, "/unknown-xyz-123");
    assert.equal(res.status, 404);
    assert.ok(res.text.includes("404"));
  });
});

describe("server — per-request props", () => {
  let tmpParent;
  let tmpRoot;
  let server;
  let baseUrl;

  before(async () => {
    tmpParent = await fs.mkdtemp(path.join(os.tmpdir(), "chocola-server-props-"));
    tmpRoot = path.join(tmpParent, "app");
    await fs.cp(FIXTURE, tmpRoot, { recursive: true });
    const handler = await createHandler(tmpRoot);
    server = http.createServer(handler);
    await new Promise((res, rej) => {
      server.once("error", rej);
      server.listen(0, "127.0.0.1", res);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (server) await new Promise((r) => server.close(r));
    if (tmpParent) await fs.rm(tmpParent, { recursive: true, force: true });
  });

  test("request-time ctx props are merged into templates", async () => {
    const res = await httpRequest(baseUrl, "/?name=Alice");
    assert.equal(res.status, 200);
    assert.ok(res.text.includes("Hello Alice!"), `expected Alice, got ${res.text.slice(0, 500)}`);
    assert.ok(!res.text.includes("Hello World!"), "should not fallback when ctx provided");
  });

  test("missing/partial props fall back to component defaults", async () => {
    const res = await httpRequest(baseUrl, "/");
    assert.equal(res.status, 200);
    assert.ok(res.text.includes("Hello World!"), "default prop should be used when ctx missing");
  });

  test("query + middleware merge: middleware return wins", async () => {
    // Create temp app with middleware that provides name
    const tmp2 = await fs.mkdtemp(path.join(os.tmpdir(), "chocola-mw-merge-"));
    const app2 = path.join(tmp2, "app2");
    await fs.cp(FIXTURE, app2, { recursive: true });
    await fs.writeFile(path.join(app2, "server-middleware.js"), `export default [ async ({ query }) => { return { name: "FromMiddleware" }; } ];`);
    const cfgPath = path.join(app2, "chocola.config.json");
    const cfg = JSON.parse(await fs.readFile(cfgPath, "utf-8"));
    cfg.server.middleware = "./server-middleware.js";
    await fs.writeFile(cfgPath, JSON.stringify(cfg, null, 2));
    const handler = await createHandler(app2);
    const srv = http.createServer(handler);
    await new Promise((res, rej) => {
      srv.once("error", rej);
      srv.listen(0, "127.0.0.1", res);
    });
    const url = `http://127.0.0.1:${srv.address().port}`;
    const res = await httpRequest(url, "/?name=FromQuery");
    // Middleware return should overwrite query (last wins, both merged, but middleware after query)
    assert.ok(res.text.includes("Hello FromMiddleware!"), `middleware should win, got ${res.text.slice(0, 300)}`);
    await new Promise((r) => srv.close(r));
    await fs.rm(tmp2, { recursive: true, force: true });
  });
});

describe("server — static assets", () => {
  let tmpParent;
  let tmpRoot;
  let server;
  let baseUrl;

  before(async () => {
    tmpParent = await fs.mkdtemp(path.join(os.tmpdir(), "chocola-server-static-"));
    tmpRoot = path.join(tmpParent, "app");
    await fs.cp(FIXTURE_BASIC, tmpRoot, { recursive: true });
    // Ensure server fixture for static test has basic assets
    const handler = await createHandler(tmpRoot);
    server = http.createServer(handler);
    await new Promise((res, rej) => {
      server.once("error", rej);
      server.listen(0, "127.0.0.1", res);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (server) await new Promise((r) => server.close(r));
    if (tmpParent) await fs.rm(tmpParent, { recursive: true, force: true });
  });

  test("local assets served with correct mime type", async () => {
    const txt = await httpRequest(baseUrl, "/static/hello.txt");
    assert.equal(txt.status, 200);
    assert.match(txt.headers["content-type"], /text\/plain/);
    assert.ok(txt.text.includes("hello static world") || txt.text.includes("hello"), "static content missing");

    const js = await httpRequest(baseUrl, "/app.js");
    assert.equal(js.status, 200);
    assert.match(js.headers["content-type"], /javascript/);

    const ico = await httpRequest(baseUrl, "/favicon.ico");
    assert.equal(ico.status, 200);
    assert.match(ico.headers["content-type"], /icon/);
  });

  test("missing file → 404", async () => {
    const res = await httpRequest(baseUrl, "/static/missing-xyz.txt");
    assert.equal(res.status, 404);
    const res2 = await httpRequest(baseUrl, "/nope.css");
    assert.equal(res2.status, 404);
  });

  test("assets answered with ETag/Last-Modified; re-request with If-None-Match → 304", async () => {
    const first = await httpRequest(baseUrl, "/static/hello.txt");
    assert.ok(first.headers["etag"], "ETag missing");
    assert.ok(first.headers["last-modified"], "Last-Modified missing");
    const second = await httpRequest(baseUrl, "/static/hello.txt", {
      headers: { "If-None-Match": first.headers["etag"] },
    });
    assert.equal(second.status, 304);

    const lm = first.headers["last-modified"];
    const third = await httpRequest(baseUrl, "/static/hello.txt", {
      headers: { "If-Modified-Since": new Date(Date.now() + 100000).toUTCString() },
    });
    assert.equal(third.status, 304, "If-Modified-Since future should be 304");
    // Ensure lm header is valid date
    assert.ok(!Number.isNaN(new Date(lm).getTime()));
  });

  test("virtual assets (scoped css / runtime) also have ETag and 304", async () => {
    // Need to discover virtual asset path from HTML
    const html = await httpRequest(baseUrl, "/");
    const match = html.text.match(/href="\.\/(sc-[a-z]+\.css)"/) || html.text.match(/href="\/(sc-[a-z]+\.css)"/);
    assert.ok(match, "scoped css link not found in HTML");
    const cssPath = "/" + match[1].replace(/^\//, "");
    const first = await httpRequest(baseUrl, cssPath);
    assert.equal(first.status, 200);
    assert.ok(first.headers["etag"]);
    const second = await httpRequest(baseUrl, cssPath, { headers: { "If-None-Match": first.headers["etag"] } });
    assert.equal(second.status, 304);
  });

  test("gzip served when Accept-Encoding: gzip and file is compressible", async () => {
    const plain = await httpRequest(baseUrl, "/static/hello.txt");
    assert.equal(plain.headers["content-encoding"], undefined);

    const gz = await httpRequest(baseUrl, "/static/hello.txt", { headers: { "Accept-Encoding": "gzip" } });
    // Our httpRequest auto-decompresses but keeps header for assertion via raw request
    // Do raw check via http without auto-decompress handling
    const raw = await new Promise((resolve, reject) => {
      const url = new URL("/static/hello.txt", baseUrl);
      const req = http.request(url, { headers: { "Accept-Encoding": "gzip" } }, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          resolve({ headers: res.headers, raw: Buffer.concat(chunks) });
        });
      });
      req.on("error", reject);
      req.end();
    });
    assert.equal(raw.headers["content-encoding"], "gzip");
    assert.equal(raw.headers["vary"], "Accept-Encoding");
    const decompressed = zlib.gunzipSync(raw.raw).toString("utf-8");
    assert.ok(decompressed.includes("hello"));

    // HTML also compressible
    const htmlGz = await new Promise((resolve, reject) => {
      const url = new URL("/", baseUrl);
      const req = http.request(url, { headers: { "Accept-Encoding": "gzip" } }, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ headers: res.headers, raw: Buffer.concat(chunks) }));
      });
      req.on("error", reject);
      req.end();
    });
    assert.equal(htmlGz.headers["content-encoding"], "gzip");
  });

  test("non-compressible assets not gzipped", async () => {
    const ico = await new Promise((resolve, reject) => {
      const url = new URL("/favicon.ico", baseUrl);
      const req = http.request(url, { headers: { "Accept-Encoding": "gzip" } }, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ headers: res.headers }));
      });
      req.on("error", reject);
      req.end();
    });
    // ico is image/vnd.microsoft.icon -> shouldCompress false
    assert.equal(ico.headers["content-encoding"], undefined);
  });
});

describe("server — middleware hook", () => {
  test("returned object from middleware is merged into ctx and shows up in render", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "chocola-mw1-"));
    const app = path.join(tmp, "app");
    await fs.cp(FIXTURE, app, { recursive: true });
    await fs.writeFile(path.join(app, "server-middleware.js"), `export default [ async ({ query }) => { return { name: "MiddlewareUser" }; } ];`);
    const cfgPath = path.join(app, "chocola.config.json");
    const cfg = JSON.parse(await fs.readFile(cfgPath, "utf-8"));
    cfg.server.middleware = "./server-middleware.js";
    await fs.writeFile(cfgPath, JSON.stringify(cfg, null, 2));
    const handler = await createHandler(app);
    const srv = http.createServer(handler);
    await new Promise((res, rej) => {
      srv.once("error", rej);
      srv.listen(0, "127.0.0.1", res);
    });
    const base = `http://127.0.0.1:${srv.address().port}`;
    const res = await httpRequest(base, "/");
    assert.equal(res.status, 200);
    assert.ok(res.text.includes("Hello MiddlewareUser!"), `expected middleware ctx, got ${res.text.slice(0,400)}`);
    await new Promise((r) => srv.close(r));
    await fs.rm(tmp, { recursive: true, force: true });
  });

  test("short-circuiting middleware wins over rendering", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "chocola-mw2-"));
    const app = path.join(tmp, "app");
    await fs.cp(FIXTURE, app, { recursive: true });
    await fs.writeFile(
      path.join(app, "server-middleware.js"),
      `export default [ (req, res) => { res.writeHead(401, {"Content-Type":"text/plain"}); res.end("blocked"); } ];`
    );
    const cfgPath = path.join(app, "chocola.config.json");
    const cfg = JSON.parse(await fs.readFile(cfgPath, "utf-8"));
    cfg.server.middleware = "./server-middleware.js";
    await fs.writeFile(cfgPath, JSON.stringify(cfg, null, 2));
    const handler = await createHandler(app);
    const srv = http.createServer(handler);
    await new Promise((res, rej) => {
      srv.once("error", rej);
      srv.listen(0, "127.0.0.1", res);
    });
    const base = `http://127.0.0.1:${srv.address().port}`;
    const res = await httpRequest(base, "/");
    assert.equal(res.status, 401);
    assert.ok(res.text.includes("blocked"));
    assert.ok(!res.text.includes("Hello"), "should not render when short-circuited");
    await new Promise((r) => srv.close(r));
    await fs.rm(tmp, { recursive: true, force: true });
  });

  test("middleware with (req,res) and ({query,cookies}) signatures both work", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "chocola-mw3-"));
    const app = path.join(tmp, "app");
    await fs.cp(FIXTURE, app, { recursive: true });
    await fs.writeFile(
      path.join(app, "server-middleware.js"),
      `
      export default [
        async ({ query }) => { return { name: query.name || "Q" }; },
        (req, res) => {
          if (req.url.includes("block")) {
            res.writeHead(402, {"Content-Type":"text/plain"});
            res.end("blocked2");
          }
        }
      ];
      `
    );
    const cfgPath = path.join(app, "chocola.config.json");
    const cfg = JSON.parse(await fs.readFile(cfgPath, "utf-8"));
    cfg.server.middleware = "./server-middleware.js";
    await fs.writeFile(cfgPath, JSON.stringify(cfg, null, 2));
    const handler = await createHandler(app);
    const srv = http.createServer(handler);
    await new Promise((res, rej) => {
      srv.once("error", rej);
      srv.listen(0, "127.0.0.1", res);
    });
    const base = `http://127.0.0.1:${srv.address().port}`;
    const res1 = await httpRequest(base, "/?name=Alice");
    assert.ok(res1.text.includes("Hello Alice!"));
    const res2 = await httpRequest(base, "/?block=1");
    assert.equal(res2.status, 402);
    await new Promise((r) => srv.close(r));
    await fs.rm(tmp, { recursive: true, force: true });
  });

  test("middleware path/config errors fail loudly with clear message", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "chocola-mw-err-"));
    const app = path.join(tmp, "app");
    await fs.cp(FIXTURE_BASIC, app, { recursive: true });
    const cfgPath = path.join(app, "chocola.config.json");
    const cfg = JSON.parse(await fs.readFile(cfgPath, "utf-8"));
    cfg.server = { middleware: "./does-not-exist.js" };
    await fs.writeFile(cfgPath, JSON.stringify(cfg, null, 2));
    let threw = false;
    let msg = "";
    try {
      await createHandler(app);
    } catch (e) {
      threw = true;
      msg = e.message || String(e);
    }
    assert.ok(threw, "should throw on missing middleware file");
    assert.match(msg, /middleware file not found/i);
    await fs.rm(tmp, { recursive: true, force: true });

    // Also test via opts middleware path
    const tmp2 = await fs.mkdtemp(path.join(os.tmpdir(), "chocola-mw-err2-"));
    const app2 = path.join(tmp2, "app2");
    await fs.cp(FIXTURE_BASIC, app2, { recursive: true });
    let threw2 = false;
    let msg2 = "";
    try {
      await createHandler(app2, { middleware: "./also-missing.js" });
    } catch (e) {
      threw2 = true;
      msg2 = e.message || String(e);
    }
    assert.ok(threw2, "should throw on opts middleware missing");
    assert.match(msg2, /middleware file not found/i);
    await fs.rm(tmp2, { recursive: true, force: true });
  });
});

describe("server — bare handler + config", () => {
  test("exposed http request handler works directly under http.createServer(handler).listen()", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "chocola-bare-"));
    const app = path.join(tmp, "app");
    await fs.cp(FIXTURE, app, { recursive: true });
    const handler = await createHandler(app);
    assert.equal(typeof handler, "function");
    const srv = http.createServer(handler);
    await new Promise((res, rej) => {
      srv.once("error", rej);
      srv.listen(0, "127.0.0.1", res);
    });
    const base = `http://127.0.0.1:${srv.address().port}`;
    const res = await httpRequest(base, "/");
    assert.equal(res.status, 200);
    assert.ok(res.text.includes("Hello"));
    // Also test createServer alias
    const handler2 = await createServer(app);
    assert.equal(typeof handler2, "function");
    const srv2 = http.createServer(handler2);
    await new Promise((res, rej) => {
      srv2.once("error", rej);
      srv2.listen(0, "127.0.0.1", res);
    });
    const base2 = `http://127.0.0.1:${srv2.address().port}`;
    const res2 = await httpRequest(base2, "/");
    assert.equal(res2.status, 200);
    await new Promise((r) => srv.close(r));
    await new Promise((r) => srv2.close(r));
    await fs.rm(tmp, { recursive: true, force: true });
  });

  test("port/middleware from chocola.config.json server block are honored", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "chocola-config-"));
    const app = path.join(tmp, "app");
    await fs.cp(FIXTURE, app, { recursive: true });
    await fs.writeFile(path.join(app, "server-middleware.js"), `export default [ async () => { return { name: "FromConfig" }; } ];`);
    const cfgPath = path.join(app, "chocola.config.json");
    const cfg = JSON.parse(await fs.readFile(cfgPath, "utf-8"));
    cfg.server = { port: 0, hostname: "127.0.0.1", middleware: "./server-middleware.js" };
    await fs.writeFile(cfgPath, JSON.stringify(cfg, null, 2));
    // serve should honor config port/hostname
    const srv = await serve(app);
    const addr = srv.address();
    assert.ok(addr.port > 0, "should listen on ephemeral port from config");
    assert.equal(addr.address, "127.0.0.1");
    const base = `http://127.0.0.1:${addr.port}`;
    const res = await httpRequest(base, "/");
    assert.equal(res.status, 200);
    assert.ok(res.text.includes("Hello FromConfig!"), `middleware from config not honored, got ${res.text.slice(0,300)}`);
    await new Promise((r) => srv.close(r));
    await fs.rm(tmp, { recursive: true, force: true });
  });

  test("createHandler({ rootDir }) object form honored", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "chocola-objform-"));
    const app = path.join(tmp, "app");
    await fs.cp(FIXTURE, app, { recursive: true });
    const handler = await createHandler({ rootDir: app });
    assert.equal(typeof handler, "function");
    const srv = http.createServer(handler);
    await new Promise((res, rej) => {
      srv.once("error", rej);
      srv.listen(0, "127.0.0.1", res);
    });
    const base = `http://127.0.0.1:${srv.address().port}`;
    const res = await httpRequest(base, "/");
    assert.equal(res.status, 200);
    await new Promise((r) => srv.close(r));
    await fs.rm(tmp, { recursive: true, force: true });
  });
});
