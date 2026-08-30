import http from "http";
import path from "path";
import { promises as fs } from "fs";
import { createHash } from "crypto";
import zlib from "zlib";
import { pathToFileURL } from "url";

import { buildModuleGraph } from "../compiler/module-graph.js";
import { renderPage } from "../compiler/render.js";
import { loadConfig, resolvePaths } from "../compiler/config.js";
import { getConfig } from "../utils.js";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".csv": "text/csv",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/vnd.microsoft.icon",
  ".icon": "image/vnd.microsoft.icon",
  ".pdf": "application/pdf",
  ".mp3": "audio/mpeg",
  ".md": "text/markdown",
  ".mp4": "video/mp4",
  ".mpeg": "video/mpeg",
  ".oga": "audio/ogg",
  ".ogv": "video/ogg",
  ".tar": "application/x-tar",
  ".ttf": "font/ttf",
  ".txt": "text/plain",
  ".wav": "audio/wav",
  ".weba": "audio/webm",
  ".webm": "video/webm",
  ".webmanifest": "application/manifest+json",
  ".webp": "image/webp",
  ".xhtml": "application/xhtml+xml",
  ".xml": "application/xml",
  ".zip": "application/zip",
};

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || "application/octet-stream";
}

function generateETag(buf) {
  const hash = createHash("sha256").update(buf).digest("hex").slice(0, 32);
  return `W/"${hash}"`;
}

function parseCookies(cookieHeader = "") {
  const out = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  }
  return out;
}

function acceptsGzip(req) {
  const ae = req.headers["accept-encoding"] || "";
  return ae.includes("gzip");
}

function shouldCompress(mime) {
  return /^(text\/|application\/(javascript|json|xml|manifest\+json))/.test(mime);
}

async function loadMiddleware(rootDir, middlewarePath) {
  if (!middlewarePath) return [];
  const resolved = path.isAbsolute(middlewarePath)
    ? middlewarePath
    : path.join(rootDir, middlewarePath);
  try {
    await fs.access(resolved);
  } catch {
    console.warn(`[chocola/server] middleware file not found: ${resolved}`);
    return [];
  }
  const imported = await import(pathToFileURL(resolved).href);
  const raw = imported.default ?? imported;
  if (Array.isArray(raw)) return raw.filter((fn) => typeof fn === "function");
  if (typeof raw === "function") return [raw];
  if (raw && typeof raw === "object") {
    // handle named exports
    const fns = Object.values(raw).filter((v) => typeof v === "function");
    if (fns.length) return fns;
  }
  return [];
}

function buildRouteTable(graph) {
  const table = new Map();
  // Single page support: index.html
  if (graph.page) {
    table.set("/", graph.page);
    table.set("/index.html", graph.page);
    table.set("/index", graph.page);
  }
  return table;
}

function sendNotModified(res) {
  res.writeHead(304);
  res.end();
}

function serveBuffer(req, res, buffer, contentType, etag, mtime) {
  const headers = {
    "Content-Type": contentType,
    "ETag": etag,
    "Last-Modified": mtime.toUTCString(),
    "Cache-Control": "public, max-age=0, must-revalidate",
    "Content-Length": buffer.length,
  };

  const inm = req.headers["if-none-match"];
  if (inm && inm === etag) {
    // Weak comparison is okay for demo; exact match suffices
    sendNotModified(res);
    return;
  }

  const ims = req.headers["if-modified-since"];
  if (ims) {
    const imsTime = new Date(ims).getTime();
    if (!Number.isNaN(imsTime) && mtime.getTime() <= imsTime) {
      sendNotModified(res);
      return;
    }
  }

  const doGzip = acceptsGzip(req) && shouldCompress(contentType);
  if (doGzip) {
    const gz = zlib.gzipSync(buffer);
    headers["Content-Encoding"] = "gzip";
    headers["Vary"] = "Accept-Encoding";
    headers["Content-Length"] = gz.length;
    if (req.method === "HEAD") {
      res.writeHead(200, headers);
      res.end();
      return;
    }
    res.writeHead(200, headers);
    res.end(gz);
    return;
  }

  if (req.method === "HEAD") {
    res.writeHead(200, headers);
    res.end();
    return;
  }
  res.writeHead(200, headers);
  res.end(buffer);
}

function normalizeRootDir(arg, opts) {
  if (typeof arg === "object" && arg !== null && !opts) {
    // createServer({ rootDir }) form
    const o = arg;
    const rd = o.rootDir || o.root || o.dir || process.cwd();
    return { rootDir: rd, opts: o };
  }
  if (typeof arg === "string") {
    return { rootDir: arg, opts: opts || {} };
  }
  // fallback
  return { rootDir: String(arg), opts: opts || {} };
}

export async function createHandler(rootDirArg, optsArg) {
  const { rootDir, opts } = normalizeRootDir(rootDirArg, optsArg);

  const fullConfig = await getConfig(rootDir).catch(() => ({}));
  const config = await loadConfig(rootDir);
  const paths = resolvePaths(rootDir, config);

  const graph = await buildModuleGraph(rootDir);

  const middlewarePath = opts.middleware ?? fullConfig.server?.middleware ?? null;
  const middlewares = await loadMiddleware(rootDir, middlewarePath);

  const routeTable = buildRouteTable(graph);

  // virtual file store for dynamically generated assets (run-*.js, sc-*.css, css-*.css, js-*.js)
  const virtualFiles = new Map(); // pathname -> { buffer, etag, mtime, type }

  function ingest(result) {
    for (const file of result.files) {
      const key = "/" + file.path;
      const buf = Buffer.from(file.content, "utf-8");
      const etag = generateETag(buf);
      virtualFiles.set(key, {
        buffer: buf,
        etag,
        mtime: new Date(),
        type: getMimeType(file.path),
      });
    }
  }

  // Prime virtual files with initial render (ensures assets exist even before first SSR)
  try {
    const initial = await renderPage(graph, {});
    ingest(initial);
  } catch (e) {
    // If initial render fails, continue; per-request render will surface error
    console.warn("[chocola/server] initial render failed:", e?.message || e);
  }

  async function handler(req, res) {
    try {
      const host = req.headers.host || "localhost";
      const url = new URL(req.url, `http://${host}`);
      let pathname = decodeURIComponent(url.pathname);

      // Normalize pathname: remove duplicate slashes
      pathname = pathname.replace(/\/+/g, "/");
      // Keep as is; do not strip trailing slash except for route lookup

      const query = Object.fromEntries(url.searchParams.entries());
      const cookies = parseCookies(req.headers.cookie || "");

      // 1) SSR route?
      // Try exact, then fallback with/without trailing slash
      let page = routeTable.get(pathname);
      if (!page && pathname.endsWith("/") && pathname.length > 1) {
        page = routeTable.get(pathname.slice(0, -1));
      }
      if (!page && !pathname.endsWith("/")) {
        page = routeTable.get(pathname + "/");
      }

      if (page) {
        // Build per-request ctx via middleware
        let ctx = { ...query };
        // Also merge opts.ctx if provided (for programmatic use)
        if (opts.ctx && typeof opts.ctx === "object") Object.assign(ctx, opts.ctx);

        for (const mw of middlewares) {
          let result;
          try {
            if (mw.length >= 2) {
              result = await mw(req, res);
            } else {
              result = await mw({
                req,
                res,
                params: {},
                query,
                cookies,
                headers: req.headers,
                url,
                pathname,
                searchParams: url.searchParams,
              });
            }
          } catch (e) {
            console.error("[chocola/server] middleware error:", e);
            if (!res.headersSent && !res.writableEnded) {
              res.writeHead(500, { "Content-Type": "text/plain" });
              res.end("Internal middleware error");
            }
            return;
          }
          if (res.writableEnded || res.headersSent) {
            return;
          }
          if (result && typeof result === "object" && !Array.isArray(result) && !(result instanceof Buffer)) {
            // Merge returned object into ctx
            Object.assign(ctx, result);
          }
        }

        let result;
        try {
          result = await renderPage(graph, ctx);
        } catch (e) {
          if (!res.headersSent && !res.writableEnded) {
            res.writeHead(500, { "Content-Type": "text/plain" });
            res.end("Render error: " + (e?.message || e));
          }
          return;
        }

        ingest(result);

        const htmlBuf = Buffer.from(result.html, "utf-8");
        const etag = generateETag(htmlBuf);
        const mtime = new Date();
        const ctype = "text/html; charset=utf-8";
        serveBuffer(req, res, htmlBuf, ctype, etag, mtime);
        return;
      }

      // 2) Virtual files (bundled css, js, runtime, scoped css)
      if (virtualFiles.has(pathname)) {
        const entry = virtualFiles.get(pathname);
        serveBuffer(req, res, entry.buffer, entry.type, entry.etag, entry.mtime);
        return;
      }

      // Also handle "./" prefix that html emits: href="./css-xxx.css" leads to request "/css-xxx.css" after browser resolves, but also handle "./" stripping
      // Already handled by virtualFiles via "/" prefix. For safety, try without leading slash variations
      // Next: try static file from src
      // Remove leading "/" and resolve against src dir
      const relative = pathname.replace(/^\/+/, "");
      // Prevent directory traversal
      const safe = path.normalize(relative).replace(/^(\.\.(\/|\\|$))+/g, "");
      const candidatePaths = [
        path.join(paths.src, safe),
        path.join(paths.src, safe + ".html"),
      ];

      for (const cand of candidatePaths) {
        try {
          const stat = await fs.stat(cand);
          if (stat.isFile()) {
            const buf = await fs.readFile(cand);
            const etag = generateETag(buf);
            const mtime = stat.mtime;
            const ctype = getMimeType(cand);
            serveBuffer(req, res, buf, ctype, etag, mtime);
            return;
          }
          if (stat.isDirectory()) {
            // try index.html inside
            const idx = path.join(cand, "index.html");
            try {
              const s2 = await fs.stat(idx);
              if (s2.isFile()) {
                const buf = await fs.readFile(idx);
                const etag = generateETag(buf);
                serveBuffer(req, res, buf, getMimeType(idx), etag, s2.mtime);
                return;
              }
            } catch {}
          }
        } catch {}
      }

      // Fallback 404
      if (!res.headersSent && !res.writableEnded) {
        res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<h1>404 Not Found</h1><p>The requested resource was not found.</p>");
      }
    } catch (err) {
      console.error("[chocola/server] handler error:", err);
      if (!res.headersSent && !res.writableEnded) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Internal server error");
      }
    }
  }

  // Attach helpers for testing / introspection
  handler.graph = graph;
  handler.virtualFiles = virtualFiles;
  handler.routeTable = buildRouteTable(graph);
  handler.paths = paths;

  return handler;
}

// Alias per lead: createServer({ rootDir }) returns bare http handler
export const createServer = createHandler;
export const createServerRenderer = createHandler; // future ssr escape hatch alias

export async function serve(rootDirArg, optsArg) {
  const { rootDir } = normalizeRootDir(rootDirArg, optsArg);
  const fullConfig = await getConfig(rootDir).catch(() => ({}));
  const serverCfg = fullConfig.server || {};
  const port = serverCfg.port ?? optsArg?.port ?? 8080;
  const hostname = serverCfg.hostname ?? serverCfg.host ?? optsArg?.hostname ?? optsArg?.host ?? "localhost";

  const handler = await createHandler(rootDir, optsArg);

  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, hostname, () => {
      console.log(`Chocola server running at http://${hostname}:${port}/`);
      resolve();
    });
  });
  return server;
}

// also export default for convenience
export default { createHandler, createServer, serve };
