---
title: Testing and development
description: Testing the core library and benchmarking the pipeline
---

To test, drive the pipeline directly from Node:

```js
import { app, buildModuleGraph, renderPage } from "chocola/compiler";

await app.build("./my-app");

const graph = await buildModuleGraph("./my-app");
const { html } = await renderPage(graph, { name: "Ada" });
```

## Testing

```sh
npm test
```

Runs `node --test "tests/**/*.test.js"` (compiler suite) covering graph
discovery, pure `renderPage`, `emit`, stable ids, routes, and props merging.
See `CONTRIBUTING.md`.

## Benchmarks

```sh
npm run bench
npm run bench:csv  # export CSV
```

Worker-isolated harness in `bench/` measures `buildModuleGraph` (cold/warm),
`renderPage` per-request cost, `emit` overhead, scaling sweeps (1–1500
components, nested depth, large pages), and stable-id overhead. Results include
median/p95/p99 and RSS/heap.
