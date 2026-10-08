---
title: Per-request rendering
description: Render pages per request with the pure renderPage pipeline
---

`renderPage(graph, ctx)` is a pure function (no disk writes) that hosts call
per request to render pages with request-time data. This is how ChocolaKit's
SSR server — and any custom host — serves dynamic pages on top of this library.

## Summary

1. [Build the graph once at startup](#1-graph) and keep it in memory without writing to disk.
2. [Map URLs to the page module](#2-route-table) so requests can be dispatched quickly.
3. [Render each request with renderPage](#3-per-request-render) using a context built from the request.
4. [Serve virtual files from memory](#4-virtual-files) with your own caching and compression.

## Usage

```js
import { buildModuleGraph, renderPage } from "chocola/compiler";
import http from "http";

const graph = await buildModuleGraph(rootDir);

const handler = async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const ctx = Object.fromEntries(url.searchParams); // per-request props
  const { html } = await renderPage(graph, ctx);
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(html);
};

http.createServer(handler).listen(8080);
```

> The dev server, production SSR server, and CLI are ChocolaKit
> (`@chocolajs/kit`), which wraps this pipeline. The pattern below is what any
> host implements.

## How it works

### 1. Graph

Build the module graph once at startup with `buildModuleGraph` in
`compiler/module-graph.js`, called with the project root directory. It performs
discovery and parsing as described in the compiler flow, but writes no files.
The result is reused for every render.

### 2. Route table

Build a small lookup mapping incoming URLs to the page module. The graph's
`page` module (`index.html`) serves `/`, `/index.html`, and `/index`. Hold the
table in memory alongside the graph.

### 3. Per-request render

Turn a single request into HTML with `renderPage` in `compiler/render.js`,
passing the shared graph and a context object named `ctx`.

Build `ctx` from request data — e.g. query parameters merged with middleware
results and any extra host context. Page and component conditionals such as
`if` and `mount:if`, and prop interpolations of the form `{prop}`, are
evaluated against this merged context, so the same page can vary per visitor.

### 4. Virtual files

Serve supporting files without writing them to disk. `renderPage` returns two
collections named `files` and `copies`: `files` holds generated assets such as
scoped CSS and runtime scripts (hashed names `sc-*`, `run-*`, `css-*`, `js-*`);
`copies` holds entries that would otherwise be copied from `src` and `static`.

Keep these assets in memory and serve them with your own `ETag` /
`Last-Modified` / `Cache-Control` handling, `304` responses for
`If-None-Match` / `If-Modified-Since`, and `gzip` compression for compressible
types.

## Limits (intentional)

The library stays transport-agnostic: single process, no routing, no body
parsing, no streaming, no exported cache. Hosts own the HTTP layer.
