---
title: Testing and development
description: Testing the core library and benchmarking the compiler
---

Chocola core exposes a small, pure API that is easy to drive from Node:

```js
import { buildModuleGraph, render, compile } from "chocola/compiler";

const graph = await buildModuleGraph(process.cwd(), { entry: "app.chjs" });
const { html, styles, runtime, hashMap } = await render(graph, { name: "Ada" });

// Or build and render in one call:
const result = await compile(process.cwd(), {
    entry: "app.chjs",
    ctx: { name: "Ada" },
});
```

`rootDir` must be absolute. `entry` is required and must end in `.chjs`. `render` performs no project I/O and writes nothing.

## Testing

```sh
npm test
```

Runs `node --test "tests/**/*.test.js"` (see the latest output for the current count) across:

- `module-source` — raw section splitting, self-closing expansion, tag scanning;
- `module-graph` — entry validation, import-only discovery, namespaces, errors;
- `render` — result shape, fragment output, slots, conditionals, scoped CSS, runtime descriptors, purity, cycles;
- `compiler-api` — exports, `compile()`, in-memory results, no writes;
- `config` — `normalizeConfig` defaults and overrides;
- `runtime` — `ChocolaComponent` mount/update/remove plus namespace mounting;
- `parser`, `tags`, and `utils` — helper behavior, classification, hashes, line lookup.

See `CONTRIBUTING.md` for contribution rules and `AGENTS.md` for agent-specific guidance.

## Benchmarks

```sh
npm run bench
npm run bench:csv  # export CSV files to bench/results/
```

The worker-isolated harness in `bench/` measures:

- `buildModuleGraph` — cold graph construction;
- `render` — pure per-request rendering;
- `compile` — build plus render in one call;
- scaling sweeps — component count (1–1500), nesting depth, and root template size;
- stable-id hashing overhead;
- runtime descriptor size and `treeShakeRuntime` filtering.

Results include median, p95, p99, min, max, RSS, and heap usage. `--csv` writes one file per table; `--csv-dir=<path>` selects the destination. `--no-csv` disables the interactive prompt.

Bench fixtures come from `tests/fixtures/basic` and synthetic `.chjs` apps generated in a temp directory. They no longer use `chocola.config.json`, `src/index.html`, `<app>`, or `.html` component files.
