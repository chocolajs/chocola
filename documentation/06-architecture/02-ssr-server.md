---
title: SSR server
description: Deployable server-side rendering with chocola/server
---

`chocola/server` renders pages per request by reusing the pure `renderPage(graph, ctx)` pipeline described in the compiler flow.

## Summary

The server flow is intentionally short and can be scanned in seconds. It builds the module graph once at startup, which is then used to serve every request.

1. [Graph is built once at startup](#1-graph) and kept in memory without writing to disk.
2. [Route table maps URLs to the page module](#2-route-table) so requests can be dispatched quickly.
3. [Each request renders with renderPage](#3-per-request-render) using a context that merges query parameters and middleware results.
4. [Virtual files are served from memory](#4-virtual-files) with caching and compression so assets are fast without touching disk.

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

The export map is defined in `package.json` under the key `./server`, which points to `./server/index.js`. That module exposes `createHandler` and `createServer` as an alias, and `createServerRenderer` as an alias, along with `serve`.

## How it works

### 1. Graph

This step prepares all knowledge about pages and components before the server accepts any requests. It runs once at startup and the result is reused for every later render. This avoids repeated file system work and keeps per-request rendering pure.

#### How it works

The graph is created by `buildModuleGraph` in `compiler/module-graph.js`. This function is called with the project root directory. It performs discovery and parsing as described in the compiler flow, but it does not write any files.

### 2. Route table

This step creates a small lookup that maps incoming URLs to the page module. It takes the graph as input and produces a table that the request handler can consult instantly. This keeps routing cheap and avoids route parsing on every request.

#### How it works

The server builds entries for the root path and for `index.html` and for `index`. Each of these is mapped to the same page module that was discovered during graph building. The table is held in memory alongside the graph.

### 3. Per-request render

This step turns a single HTTP request into HTML. It takes query parameters and middleware results as input and produces rendered HTML plus asset descriptors. Because conditionals and interpolations are evaluated against this per-request context, the same page can vary per visitor.

#### How it works

Rendering is handled by `renderPage` in `compiler/render.js`. This function receives the shared graph and a context object named `ctx`.

The context is built by merging three sources. First, query parameters from the URL. Second, objects returned by middleware. Third, any extra context passed via options under `opts.ctx`. Page and component conditionals such as `if` and `mount:if`, and prop interpolations of the form `{prop}`, are then evaluated against this merged context.

### 4. Virtual files

This step serves supporting files without writing them to disk. It takes the file and copy descriptors returned by `renderPage` and serves them from memory with proper caching and compression. This makes asset delivery fast while keeping the file system clean.

#### How it works

Rendering returns two collections named `files` and `copies`. `files` holds generated assets such as scoped CSS files and runtime scripts. These use hashed names of the form `sc-*` for scoped styles and `run-*` for runtime and `css-*` for stylesheets and `js-*` for scripts. `copies` holds entries that would otherwise be copied from `src` and from `static` on disk.

The server keeps these assets in memory. When a browser requests one, the response includes an `ETag` derived from a sha256 hash, along with `Last-Modified` and `Cache-Control` headers. If the request includes `If-None-Match` or `If-Modified-Since`, the server can return `304 Not Modified` without a body.

Compression is also handled in memory. If the request advertises `gzip` via `Accept-Encoding`, the server gzips the response and adds a `Vary` header to indicate the encoding differs by request. This applies to the generated hashed files and to files served from `src` and `static`.

## Middleware

This feature lets you inject per-request data or short-circuit a request before rendering. Configuration comes from `chocola.config.json`, and the middleware module is loaded once at startup. This keeps request logic separate from page templates.

#### How it works

The config shape is as follows.

```json
{ "server": { "port": 8080, "hostname": "localhost", "middleware": "./middleware.js" } }
```

The middleware file is an ESM module with a default export that can be an array or a function or an object. Two function signatures are supported. The first receives `req` and `res` and may short-circuit the response, for example by calling `res.writeHead(401).end()` for authentication. The second receives an object with `params`, `query`, `cookies`, `headers`, `url`, `pathname`, `req` and `res`, and returns an object that is then merged into `ctx`. Both signatures may be mixed in an array. If the configured file is missing, startup throws an error.

## Limits (intentional)

The server is designed to stay small and focused. It runs as a single process and does not provide dynamic route parameters. It also does not include body parsing or streaming, and it does not export a cache layer. These choices keep the implementation easy to reason about and fast for the targeted use case.
