---
title: Testing and development
description: Dev server, SSR server, testing and benchmarks
---

## Dev Server with Hot-Reload

To test your Chocola app with hot-reload, run:

```sh
node chocola.server.js
```

This starts a local dev server (`chocola/dev`) that rebuilds and live-reloads on file changes (polling `/api/hot-reload`). Use it for development — not for production.

## SSR Server (production)

For server-side rendering in production, use `chocola/server`:

```js
import { serve, createHandler } from "chocola/server";
import http from "http";

// option 1: serve() honors chocola.config.json -> server.port/hostname/middleware
serve(__dirname);

// option 2: bare handler
const handler = await createHandler(__dirname);
http.createServer(handler).listen(8080);
```

Routes `/`, `/index.html`, and `/index` are SSR-rendered per request via `renderPage(graph, ctx)` where `ctx` merges query params and middleware returns. Virtual assets (`sc-*`/`run-*`/`css-*`/`js-*`) and `src/static` are served with `ETag`/`Last-Modified`, `304` handling, and `gzip` when compressible.

Configure via `chocola.config.json`:

```json
{
  "server": {
    "port": 8080,
    "hostname": "localhost",
    "middleware": "./middleware.js"
  }
}
```

Middleware is an ESM file with a default export of `Array | Function | Object` supporting `(req, res)` short-circuit or `({ query, cookies, headers, url }) => ctx` merging.

## Testing

```sh
npm test
```

Runs `node --test "tests/**/*.test.js"` (compiler + SSR server, ~27 tests) covering graph discovery, pure `renderPage`, `emit`, stable ids, routes, props/middleware merging, static/ETag/gzip, and `createHandler` usage. See `CONTRIBUTING.md`.

## Benchmarks

```sh
npm run bench
npm run bench:csv  # export CSV
```

Worker-isolated harness in `bench/` measures `buildModuleGraph` (cold/warm), `renderPage` per-request cost, `emit` overhead, scaling sweeps (1–1500 components, nested depth, large pages), and stable-id overhead. Results include median/p95/p99 and RSS/heap.
