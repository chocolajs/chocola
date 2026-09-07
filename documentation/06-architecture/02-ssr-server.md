---
title: SSR server
description: Deployable server-side rendering with chocola/server
---

`chocola/server` renders pages per request by reusing the pure `renderPage(graph, ctx)` pipeline.

## Usage

```js
import { serve, createHandler } from "chocola/server";
import http from "http";

// honors chocola.config.json -> server.port / hostname / middleware
serve(__dirname);

// or bare http handler
const handler = await createHandler(__dirname);
http.createServer(handler).listen(8080);
```

Export map: `package.json` → `"./server": "./server/index.js"` exposes `createHandler`, `createServer` (alias), `createServerRenderer` (alias), and `serve`.

## How it works

1. **Graph** — `buildModuleGraph(rootDir)` once at startup (discovery, no writes).
2. **Route table** — `/`, `/index.html`, `/index` → page module.
3. **Per-request render** — `renderPage(graph, ctx)` where `ctx = { ...query, ...middlewareReturns, ...opts.ctx }`. Page and component conditionals (`if`/`mount:if`) and `{prop}` interpolation are evaluated against this `ctx`.
4. **Virtual files** — `{ files, copies }` from render are served from memory with `ETag` (sha256), `Last-Modified`, `Cache-Control`, `304` (`If-None-Match`/`If-Modified-Since`), and `gzip` (`Accept-Encoding` + `Vary`) for `sc-*`/`run-*`/`css-*`/`js-*` plus `src/` and `static/` on disk.

## Middleware

`chocola.config.json`:

```json
{ "server": { "port": 8080, "hostname": "localhost", "middleware": "./middleware.js" } }
```

Middleware is an ESM file with default export `Array | Function | Object`:

- `(req, res) => {}` — short-circuit (e.g. auth `res.writeHead(401).end()`)
- `({ params, query, cookies, headers, url, pathname, req, res }) => ctx` — returned object merged into `ctx`

Both signatures may be mixed in an array. Missing file throws.

## Limits (intentional)

Single process, no dynamic route params, no body parsing/streaming, no exported cache.
