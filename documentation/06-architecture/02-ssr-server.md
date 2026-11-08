---
title: Per-request rendering
description: Render components per request with the pure core API
---

`render(graph, ctx)` is a pure function (no project I/O, no writes) that hosts call per request to render with request-time data. This is how ChocolaKit's dev server and SSR server — and any custom host — serve dynamic pages on top of this library.

## Summary

1. [Build a graph once at startup](#1-graph) for each root entry and keep it in memory.
2. [Map URLs to entries](#2-routing) in the host.
3. [Render each request with render](#3-per-request-render) using a context built from the request.
4. [Assemble and serve the result](#4-serving) with your own document shell, caching, and compression.

## Usage

```js
import { buildModuleGraph, render } from "chocola/compiler";
import http from "http";

const rootDir = process.cwd();
const graph = await buildModuleGraph(rootDir, { entry: "app.chjs" });

const handler = async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const ctx = Object.fromEntries(url.searchParams); // per-request props
  const { html, styles, runtime } = await render(graph, ctx);

  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(`<!doctype html>
<html>
  <head><style>${styles}</style></head>
  <body>${html}</body>
</html>`);
};

http.createServer(handler).listen(8080);
```

`runtime` is a list of `{ name, content }` ESM chunks. A real host serves those chunks at stable URLs instead of embedding them.

> The dev server, production SSR server, and CLI are ChocolaKit
> (`@chocolajs/kit`), which wraps this pipeline. The pattern below is what any
> host implements.

## How it works

### 1. Graph

Build a module graph once at startup with `buildModuleGraph` in
`compiler/module-graph.js`, called with an absolute project root and a required
`.chjs` entry. It reads the reachable `.chjs` modules and parses them, but
writes no files. The result can be reused for every render.

If your app has multiple roots, build one graph per root entry and keep the
graphs in a map.

### 2. Routing

Chocola core has no routing and no page module. The host maps incoming URLs to a
root entry and its graph:

```js
const graphs = new Map([
  ["/", await buildModuleGraph(rootDir, { entry: "pages/home.chjs" })],
  ["/about", await buildModuleGraph(rootDir, { entry: "pages/about.chjs" })],
]);
```

### 3. Per-request render

Turn a request into a result with `render` in `compiler/render.js`, passing the
shared graph and a context object named `ctx`.

Build `ctx` from request data — query parameters, middleware results, session
values, and any extra host context. Component conditionals such as `if` and
`mount:if`, and prop interpolations of the form `{prop}`, are evaluated against
this context, so the same graph can render differently per visitor.

Each call creates fresh render state, so concurrent requests do not share
mutable data.

### 4. Serving

`render` returns exactly:

- `html` — the root component fragment;
- `styles` — scoped component CSS;
- `runtime` — `{ name, content }` ESM chunks;
- `hashMap` — module ids mapped to CSS ids.

The host owns:

- the document shell (`<html>`, `<head>`, `<body>`, global styles, metadata);
- writing or serving `styles` (inline or as a CSS file);
- serving runtime chunks under the names returned in `runtime`;
- routing, static assets, bundling of non-`.chjs` imports, and hash persistence.

Keep runtime chunks in memory or on disk and serve them with your own `ETag` /
`Last-Modified` / `Cache-Control` handling, `304` responses for
`If-None-Match` / `If-Modified-Since`, and `gzip` compression for compressible
types.

## Limits (intentional)

The library stays transport-agnostic: single process, no routing, no body
parsing, no streaming, no exported cache. Hosts own the HTTP layer.
