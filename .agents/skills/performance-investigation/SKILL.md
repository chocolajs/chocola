---
name: performance-investigation
description: Diagnose Chocola build/render regressions via bench harness, isolate bottlenecks in module-graph/pipeline/component-processor, and produce actionable fixes with before/after metrics
---

# Performance Investigation

## What I do
- Run the isolated bench harness (`bench/index.js` + `bench/worker.js`) to get reproducible medians/p95/p99 and memory peaks
- Break down cold-build phases (config, discover, page-scan, component-compile, render, emit) to pinpoint regressions
- Profile scaling dimensions (component count, nesting depth, page source size) via synthetic fixtures (`bench/fixtures.js`)
- Identify hotspots in `compiler/module-graph.js`, `compiler/component-processor.js`, `compiler/pipeline.js`, `compiler/render.js`, `parser/`, and `compiler/dom-processor.js`
- Propose minimal fixes and verify with before/after bench results

## When to use me
Use when asked to investigate performance, slow builds, slow renders, scaling issues, memory pressure, or "benchmark" / "perf" tasks in Chocola. Also use when a PR touches compiler hot paths and needs quantified impact.

## Workflow

### 1. Establish baseline (worker-isolated)

```bash
node bench/index.js            # interactive; prompts for CSV export
node bench/index.js --csv      # auto-export to bench/results/*.csv
node bench/index.js --csv --csv-dir=/tmp/out
npm run bench                  # alias for above
npm run bench:csv
```

What it runs (`bench/index.js:276` → `main()`):
- **reference** (`benchReference:169`): `tests/fixtures/basic` build vs render vs emit (n=9) + derived `write overhead`
- **cold breakdown** (`benchColdBuild:208`): `config` → `discover` → `page scan` → `component compile (remainder)` → `total buildModuleGraph` for `basic` and synthetic 200 components
- **scaling** (`benchScaling:214`): components=[1,10,50,200,500,1500], depth=[1,5,10], pageSizeKb=[64,256] (n=5)
- **stable-id** (`benchStableIds:246`): `runtimeFunctionId` micro-benchmark (200 hashes) vs build

Each scenario runs in a fresh `Worker` (`bench/index.js:19` `runScenario` → `bench/worker.js:1`) with `quiet()` silencing and `measure()` warmup+median (`bench/worker.js:36`). Results table columns: `median | p95 | p99 | min | max | rss peak | heap peak` (`TIME_HEAD:60`).

Record baseline tables. If `--csv` exported, keep `bench/results/*.csv` for PR evidence.

### 2. Reproduce the reported scenario
- If bug report names a fixture, replicate it: `makeSyntheticApp({ components, depth, pageSizeKb })` in `bench/fixtures.js:56`
- For `basic` fixture, use `BASIC_FIXTURE` / `writeBasicApp` (`bench/fixtures.js:8`)
- For custom repro, write a minimal repro script that calls `buildModuleGraph(root)` (`compiler/module-graph.js:155`), `renderPage(graph)` (`compiler/render.js:136`), `emit(graph)` (`compiler/index.js:61`) directly and times with `performance.now()` — mirror `worker.js:120` scenarios

### 3. Isolate the phase
Compare breakdown rows (`bench/index.js:187` `coldBreakdown`):

| Step | Worker scenario | Underlying calls |
|---|---|---|
| `config` | `scenarioConfig:134` | `loadConfig` + `resolvePaths` (`compiler/config.js:4`) |
| `discover` | `scenarioDiscover:141` | `getSrcIndex` + `getComponents` (`compiler/pipeline.js:6`, `compiler/pipeline.js:42`) — includes `fs.readdir` + parallel `fs.readFile` per component |
| `page scan` | `scenarioPageScan:156` | `createDOM` + `querySelectorAll("*")` dep scan + asset collection (`compiler/dom-processor.js:7`, `compiler/module-graph.js:115`) |
| `component compile (remainder)` | derived | `total - config - discover - pageScan` → `compileComponentModule` loop (`compiler/module-graph.js:198`) + `extractPropsDefaults` / `extractTopLevelFunctions` / `deterministicHash` / `runtimeFunctionId` |
| `renderPage` | `scenarioRender:124` | `processAllComponents` → `processComponentElement` recursion (`compiler/component-processor.js:235`, `compiler/component-processor.js:601`) + `generateRuntimeScript` + `processAssets` |
| `emit` | `scenarioEmit:129` | `renderPage` + `fs.writeFile`/`fs.cp` per file (`compiler/index.js:67`) |

Heuristics:
- `discover` dominates → check `Promise.all(reads)` contention, `fs` on many files, `componentsLib` filtering
- `page scan` dominates → DOM walk cost on large `index.html` (linkedom `querySelectorAll`), `getAssetLinks`/`getScriptElements`
- `component compile` remainder dominates → per-component `parseHTML` + regex import scan (`compiler/module-graph.js:93`), `deterministicHash` (`compiler/utils.js:103`), `runtimeFunctionId` (`compiler/utils.js:112`)
- `render` dominates → `processComponentElement` recursion, `scopeCss`, `interpolateNode`/`compileExpr` cache misses (`parser/`), `generateCSRClass`
- `emit` write overhead large → file count / hashing in `processStylesheet`/`processScript` (`compiler/pipeline.js:59`, `compiler/pipeline.js:93`), `copyStaticDir`

### 4. Profile deeper (only after bench isolation)
- Single-run flame: `node --cpu-prof bench/worker.js` or `node --prof` then `node --prof-process isolate-*.log`
- Heap: `node --expose-gc` + `v8.getHeapStatistics()` around `buildModuleGraph`
- Micro: isolate function in `bench/worker.js:37` `measure()` loop; for `runtimeFunctionId`, use existing `benchStableIds:246` pattern
- Synthetic sweeps: vary one param at a time via `makeSyntheticApp` to get linearity (e.g. `components=500` vs `1500` should be ~3x if O(n))

Do not run profiling in the main process — worker isolation avoids JIT pollution. Keep `RUNS` at defaults (9/5) for comparability; increase only if p95 variance >10%.

### 5. Fix and verify
- Keep fixes scoped to the isolated phase. Common wins:
  - Cache `parseHTML` results or `compileExpr` by string (see `parser/utils.js` memoization pattern)
  - Hoist regex compilation, avoid per-component `deterministicHash` recompute
  - Replace `querySelectorAll("*")` full walks with targeted scans where possible
  - Batch `fs` ops, reuse `loadedComponents` map (`compiler/module-graph.js:46`)
- Re-run full `node bench/index.js --csv` and diff `median` + `heap peak`. A fix must show median win outside p95 noise and no heap regression.
- Run full test suite: `npm test` (`package.json:31` → `node --test "tests/**/*.test.js"`). Per `AGENTS.md` and `CONTRIBUTING.md:88`, PRs require full suite + test plan.

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
- File:line (e.g. compiler/component-processor.js:73 scopeCss per element)
- Why it scales with <dimension>

## Fix
- What changed (1-3 bullets)
- Before/after table (same bench run)
- Tests: npm test — <result>

## Follow-ups (optional)
- Remaining headroom, next bottleneck
```

### Tips
- Always quote `bench/index.js:50` `fmt()` and `bench/index.js:54` `fmtBytes()` units when reporting; use raw CSV values for precise diffs (`timeRow:76` `raw`).
- Synthetic fixtures write to `os.tmpdir()/chocola-bench-*` and cleanup after each worker (`bench/fixtures.js:15`); leave no temp fixture in `tests/fixtures/`.
- Do not edit `bench/` harness unless the investigation itself requires a new scenario — add scenarios as new `SCENARIOS` entries in `bench/worker.js:170`.
- If investigation is inconclusive, state variance and next profiling step rather than guessing.
