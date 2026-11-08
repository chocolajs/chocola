---
name: performance-investigation
description: Diagnose Chocola build/render regressions via the bench harness, isolate bottlenecks in module-graph/module-source/component-processor, and produce actionable fixes with before/after metrics
---

# Performance Investigation

## What I do
- Run the isolated bench harness (`bench/index.js` + `bench/worker.js`) to get reproducible medians/p95/p99 and memory peaks
- Break down graph construction, parsing, render, and runtime descriptor generation to pinpoint regressions
- Profile scaling dimensions (component count, nesting depth, root template size) via synthetic `.chjs` fixtures (`bench/fixtures.js`)
- Identify hotspots in `compiler/module-graph.js`, `compiler/module-source.js`, `compiler/component-processor.js`, `compiler/render.js`, `parser/`, and `compiler/dom-processor.js`
- Propose minimal fixes and verify with before/after bench results

## When to use me
Use when asked to investigate performance, slow builds, slow renders, scaling issues, memory pressure, or "benchmark" / "perf" tasks in Chocola. Also use when a PR touches compiler hot paths and needs quantified impact.

## Workflow

### 1. Establish baseline (worker-isolated)

```bash
node bench/index.js            # interactive; prompts for CSV export
node bench/index.js --csv      # auto-export to bench/results/*.csv
node bench/index.js --csv --csv-dir=/tmp/out
pnpm run bench                  # alias for above
pnpm run bench:csv
```

What it runs (`bench/index.js` → `main()`):
- **reference**: `tests/fixtures/basic` `buildModuleGraph` vs `render` vs `compile` (n=9), plus module count and root template bytes from the graph
- **scaling**: components=[1,10,50,200,500,1500], nesting depth=[1,5,10], root template=[64,256] KB (n=5)
- **stable-id**: `runtimeFunctionId` micro-benchmark (200 module ids) vs build
- **runtime-size**: 100 synthetic `.chjs` components, render descriptors, and verify unused helpers are dropped

Each scenario runs in a fresh `Worker` (`bench/index.js` `runScenario` → `bench/worker.js`) with `quiet()` silencing and `measure()` warmup+median. Results table columns: `median | p95 | p99 | min | max | rss peak | heap peak` (`TIME_HEAD`).

Record baseline tables. If `--csv` exported, keep `bench/results/*.csv` for PR evidence.

### 2. Reproduce the reported scenario
- If a bug report names a fixture, replicate it: `makeSyntheticApp({ components, depth, rootTemplateKb })` in `bench/fixtures.js`
- For the `basic` fixture, use `BASIC_FIXTURE` / `writeBasicApp` (`bench/fixtures.js`)
- For custom repro, write a minimal repro script that calls `buildModuleGraph(root, { entry: "app.chjs" })` (`compiler/module-graph.js`), `render(graph, ctx)` (`compiler/render.js`), and optionally `compile(root, { entry })` (`compiler/index.js`) directly and time with `performance.now()` — mirror the `bench/worker.js` scenarios

### 3. Isolate the phase
Compare the reference and scaling rows:

| Step | Worker scenario | Underlying calls |
|---|---|---|
| `buildModuleGraph` | `scenarioBuild` | `parseModuleSource` (`compiler/module-source.js`) + import resolution/queue (`compiler/module-graph.js`) + `deterministicHash`/`runtimeFunctionId` (`compiler/utils.js`) |
| `render` | `scenarioRender` | `renderInstance` recursion + conditional/slot handling + interpolation + `scopeCss` (`compiler/component-processor.js`, `parser/`) |
| `render` (CSR side) | same | `generateAllCSRClasses` + `buildModuleChunks` + `generateRuntime` (`compiler/component-processor.js`, `compiler/runtime-generator.js`) |
| `compile` | `scenarioCompile` | graph build + render in one call (`compiler/index.js`) |

Heuristics:
- `buildModuleGraph` dominates → check per-module `fs.readFile`, raw section scanning, tag scanning, and `deterministicHash` recomputation
- `render` dominates with many components → check `renderInstance` recursion, `parseFragment`/`protectCurlyBraces`, `scopeCss`, `interpolateNode`/`compileExpr` cache misses, and CSR class generation
- `render` dominates with a large root template → check full-fragment `querySelectorAll("*")` walks and per-element attribute interpolation
- Memory grows with components → check retained fragments, CSR class sources, and module chunk strings in the result
- `compile` is roughly `build + render`; a gap points to descriptor assembly or repeated work

### 4. Profile deeper (only after bench isolation)
- Single-run flame: `node --cpu-prof bench/worker.js` or `node --prof` then `node --prof-process isolate-*.log`
- Heap: `node --expose-gc` + `v8.getHeapStatistics()` around `buildModuleGraph`/`render`
- Micro: isolate a function in the `bench/worker.js` `measure()` loop; for `runtimeFunctionId`, use the existing `benchStableIds` pattern
- Synthetic sweeps: vary one param at a time via `makeSyntheticApp` to check linearity (e.g. `components=500` vs `1500` should be ~3x if O(n))

Do not run profiling in the main process — worker isolation avoids JIT pollution. Keep `RUNS` at defaults (9/5) for comparability; increase only if p95 variance >10%.

### 5. Fix and verify
- Keep fixes scoped to the isolated phase. Common wins:
  - Cache `compileExpr` by string (see `parser/utils.js` memoization pattern)
  - Hoist regex compilation; avoid repeated `deterministicHash` calls for the same module id
  - Replace full-fragment `querySelectorAll("*")` walks with targeted scans where possible
  - Reuse parsed module data from `parseModuleSource` instead of re-splitting sections
  - Avoid rebuilding CSR class sources or runtime chunks more than once per render
- Re-run full `node bench/index.js --csv` and diff `median` + `heap peak`. A fix must show a median win outside p95 noise and no heap regression.
- Run the full test suite: `pnpm test` (`package.json` → `node --test "tests/**/*.test.js"`). Per `AGENTS.md` and `CONTRIBUTING.md`, PRs require the full suite + test plan.

### 6. Report template
Output a concise markdown report:

```
## Baseline
- bench/index.js --csv results (paste table or link to CSVs)
- env: chocola <version>, node <version>, <platform/arch>

## Breakdown
- Which phase regressed and by how much (median, p95, rss/heap)
- Scaling signal (e.g. components=500 build median Xms → Yms)

## Root cause
- File:line (e.g. compiler/component-processor.js scopeCss per element)
- Why it scales with <dimension>

## Fix
- What changed (1-3 bullets)
- Before/after table (same bench run)
- Tests: pnpm test — <result>

## Follow-ups (optional)
- Remaining headroom, next bottleneck
```

### Tips
- Always quote `bench/index.js` `fmt()` and `fmtBytes()` units when reporting; use raw CSV values for precise diffs (`timeRow` `raw`).
- Synthetic fixtures write to `os.tmpdir()/chocola-bench-*` and clean up after each worker (`bench/fixtures.js`); leave no temp fixture in `tests/fixtures/`.
- Do not edit the `bench/` harness unless the investigation itself requires a new scenario — add scenarios as new `SCENARIOS` entries in `bench/worker.js`.
- If an investigation is inconclusive, state variance and the next profiling step rather than guessing.
