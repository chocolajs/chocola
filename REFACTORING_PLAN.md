# Chocola Core / Metaframework Separation Plan

## Status: ✅ COMPLETED, then SUPERSEDED by ChocolaKit split

The separation described below was implemented (#186), and afterwards the
metaframework was removed from this repo entirely (#191). This repo now
contains only the core library (`chocola`); the metaframework lives in its
own repo as ChocolaKit (`@chocolajs/kit`). Treat the `metaframework/`
sections below as historical — the core-library sections (pure compiler,
`utils.js` split, `package.json` exports) still describe this repo.

## What Was Done

### Core Library (consumable by any stack including Vite)
- `compiler/` — stripped all `console.log`/`console.warn`/`chalk` side effects; `loadConfig` is now pure; `buildModuleGraph` and `compile` produce no output
- `parser/` — unchanged (already pure)
- `runtime/` — unchanged (already pure)
- `utils.js` — reduced to only core string utilities: `protectCurlyBraces`, `restoreCurlyBraces`, `restoreTemplateChars`
- `package.json` — updated exports: `.` (main), `./compiler`, `./runtime`, `./parser`; `bin` points to `metaframework/bin/chocola.js`

### Metaframework
- `metaframework/dev/` — dev server with hot-reload (imports from core)
- `metaframework/server/` — SSR production server (imports from core)
- `metaframework/bin/` — CLI tool (imports from core)
- `metaframework/utils.js` — config utilities: `getConfig`, `isMissingConfigFile`, `queueConfigWarning`, `flushConfigWarnings`
- `metaframework/package.json` — `chocola-metaframework` with dependency on `chocola`

### Vite Compatibility
The core is now Vite-plugin-consumable: `compile(rootDir)` returns a Promise, `buildModuleGraph(rootDir)` returns a `ModuleGraph`, `emit(graph)` writes files. No console output, no `process.env` checks in the core pipeline.

## Target Architecture

```
chocola/
├── package.json              # Core library package (consumable by any stack)
├── compiler/                 # Core compilation pipeline
│   ├── index.js              # compile(), emit(), buildModuleGraph(), renderPage(), app
│   ├── config.js             # loadConfig(), resolvePaths()
│   ├── module-graph.js       # ChocolaModule, ModuleGraph, buildModuleGraph()
│   ├── render.js             # renderPage()
│   ├── dom-processor.js      # DOM utilities
│   ├── component-processor.js # Component processing
│   ├── pipeline.js           # getComponents(), getSrcIndex(), etc.
│   ├── fs.js                 # readMyFile(), checkFile()
│   ├── chalk.js              # ANSI color utility
│   ├── utils.js              # throwError, deterministicHash, runtimeFunctionId, etc.
│   ├── runtime-generator.js  # generateRuntimeScript()
│   └── runtime/index.js      # ChocolaComponent class
├── parser/                   # Script/Template/CSS parsing
│   └── ...
├── runtime/                  # ChocolaComponent class
├── utils.js                  # Core shared utilities (protectCurlyBraces, etc.)
├── metaframework/            # The metaframework layer (consumes core)
│   ├── package.json          # Depends on "chocola"
│   ├── dev/
│   │   └── index.js          # Dev server with hot-reload
│   ├── server/
│   │   └── index.js          # SSR production server
│   ├── bin/
│   │   └── chocola.js        # CLI tool
│   └── utils.js              # Config utilities
├── tests/                    # Updated test references
├── bench/                    # Updated bench references (unchanged imports)
└── documentation/
```

## Current Architecture Problems

1. **Root `package.json` is monolithic** — exports `compiler`, `dev`, `server`, `bin` all in one package
2. **Root `utils.js` mixes concerns** — contains both core string utilities (`protectCurlyBraces`) and metaframework config utilities (`getConfig`, `queueConfigWarning`)
3. **Compiler has console.log side effects** — `logBanner()`, `console.log("> Creating...")`, `console.log("Components found...")` are baked into `compiler/index.js` and `compiler/module-graph.js`. These make it impossible to use as a Vite plugin
4. **`dev/`, `server/`, `bin/` are at the root level** — not organized as a separate metaframework layer

## Target Architecture

```
chocola/
├── package.json              # Core library package (consumable by any stack)
├── compiler/                 # Core compilation pipeline (unchanged logic, cleaned side effects)
│   ├── index.js              # compile(), emit(), buildModuleGraph(), renderPage(), app
│   ├── config.js             # loadConfig(), resolvePaths()
│   ├── module-graph.js       # ChocolaModule, ModuleGraph, buildModuleGraph()
│   ├── render.js             # renderPage()
│   ├── dom-processor.js      # DOM utilities
│   ├── component-processor.js # Component processing
│   ├── pipeline.js           # getComponents(), getSrcIndex(), processStylesheet(), etc.
│   ├── fs.js                 # readMyFile(), checkFile()
│   ├── chalk.js              # ANSI color utility
│   ├── utils.js              # throwError, deterministicHash, runtimeFunctionId, etc.
│   ├── runtime-generator.js  # generateRuntimeScript()
│   └── runtime/index.js      # ChocolaComponent class
├── parser/                   # Script/Template/CSS parsing
│   ├── index.js              # Re-exports
│   ├── script.js             # parseScript(), computeReachable()
│   ├── component.js          # extractPropsDefaults(), extractRuntime(), etc.
│   ├── context.js            # extractCtxFromEl(), hasMountIf(), etc.
│   ├── template.js           # validateChainStructure(), applyConditionalToElement(), etc.
│   ├── css.js                # scopeCss()
│   └── utils.js              # compileExpr(), evaluateConstant()
├── utils.js                  # CORE shared utilities (only protectCurlyBraces, restoreCurlyBraces, restoreTemplateChars)
├── metaframework/            # The metaframework layer (consumes core)
│   ├── package.json          # Depends on "chocola" (or local path)
│   ├── dev/
│   │   └── index.js          # Dev server with hot-reload
│   ├── server/
│   │   └── index.js          # SSR production server
│   ├── bin/
│   │   └── chocola.js        # CLI tool
│   └── utils.js              # Config utilities (getConfig, isMissingConfigFile, etc.)
├── tests/                    # Updated test references
├── bench/                    # Updated bench references
└── documentation/
```

## Changes Required

### Phase 1: Core Cleanup (Vite-Compatible)

#### 1.1 Strip console.log from `compiler/index.js`
- Remove `logBanner()` function
- Remove `logSuccess()` function
- Remove `console.log("> Creating Chocola static build...")`
- Add `silent` option to `compile()` and `emit()`
- The `app` object should not print anything
- All progress output should be configurable via a `logger` option

#### 1.2 Strip console.log from `compiler/module-graph.js`
- Remove `console.log("> Components found...")` and `console.log("   ", componentsLib, "\n\n")`
- Remove `console.warn(chalk.bold.yellow("WARNING!"), "The following component files are empty:")`
- Add `silent` option to `buildModuleGraph()`
- Warnings should be returned or passed through a callback

#### 1.3 Update `compiler/component-processor.js`
- Remove `console.warn(chalk.yellow(...))` calls for missing templates and JS imports
- Make warnings configurable via options

### Phase 2: Split utils.js

#### 2.1 Root `utils.js` → Core only
Keep: `protectCurlyBraces`, `restoreCurlyBraces`, `restoreTemplateChars`
Remove: `getConfig`, `isMissingConfigFile`, `queueConfigWarning`, `flushConfigWarnings`

#### 2.2 Create `metaframework/utils.js`
Move: `getConfig`, `isMissingConfigFile`, `queueConfigWarning`, `flushConfigWarnings`
Also move: `warnedMissing`, `warnedBlockBundle`, `warnedBlockDev`, `warnedBlockServer`, `configWarningBuffers`

### Phase 3: Create metaframework/ Folder

#### 3.1 Move `dev/index.js` → `metaframework/dev/index.js`
- Update all imports: `../compiler/` → `../../compiler/`, `../utils.js` → `../utils.js` (metaframework utils)
- `compile` import from `../compiler/index.js` → `../../compiler/index.js`
- `chalk` import from `../compiler/chalk.js` → `../../compiler/chalk.js`
- `config` imports from `../compiler/config.js` → `../../compiler/config.js`
- `utils` imports from `../utils.js` → `./utils.js`

#### 3.2 Move `server/index.js` → `metaframework/server/index.js`
- Same import updates as dev

#### 3.3 Move `bin/chocola.js` → `metaframework/bin/chocola.js`
- Same import updates
- `chalk` import from `../compiler/chalk.js` → `../../compiler/chalk.js`
- `config` imports from `../compiler/config.js` → `../../compiler/config.js`
- `utils` imports from `../utils.js` → `../utils.js` (metaframework utils)
- `compile` import from `../compiler/index.js` → `../../compiler/index.js`
- `dev` import from `../dev/index.js` → `../dev/index.js`
- `server` import from `../server/index.js` → `../server/index.js`

### Phase 4: Update package.json Files

#### 4.1 Root `package.json` (core)
- Remove `dev`, `server` from `exports`
- Remove `bin` entry (or point to `metaframework/bin/chocola.js`)
- Remove `dev/`, `server/`, `bin/` from `files`
- Add `metaframework/` to `files`
- Keep `compiler/`, `runtime/`, `parser/`, `utils.js`
- Add proper `main`, `module`, `exports` fields
- Remove `"bin"` from root, add to metaframework package.json

#### 4.2 Create `metaframework/package.json`
- `name`: `chocola-metaframework` (or `@chocola/metaframework`)
- `main`: `index.js`
- `bin`: `{ "chocola": "./bin/chocola.js", "chjs": "./bin/chocola.js" }`
- `dependencies`: `"chocola": "file:.."` (or `^2.0.0-next.12`)
- `exports`: `{ "./dev": "./dev/index.js", "./server": "./server/index.js" }`
- `files`: `["dev/", "server/", "bin/"]`

### Phase 5: Update Tests and Bench

#### 5.1 Tests
- `tests/compiler.test.js` — import paths unchanged (still use `../compiler/`)
- `tests/server.test.js` — import `createHandler` etc. from `../server/index.js` → `../metaframework/server/index.js`
- `tests/cli.test.js` — import CLI from `../bin/chocola.js` → `../metaframework/bin/chocola.js`
- `tests/config.test.js` — import `getConfig` from `../utils.js` → `../metaframework/utils.js` (or keep in core utils if needed)

Wait — tests use `getConfig` and `isMissingConfigFile` from `../utils.js`. After splitting, these move to `metaframework/utils.js`. Tests that need config utilities should import from `../metaframework/utils.js`.

Actually, looking more carefully at `tests/config.test.js`, it imports `getConfig`, `isMissingConfigFile` from `../utils.js`. After the split, these need to come from `../metaframework/utils.js`.

#### 5.2 Bench
- `bench/worker.js` — imports from `../compiler/` (unchanged)
- `bench/index.js` — check for any metaframework imports

### Phase 6: Vite Plugin Consideration

The core should expose a clean API for Vite plugin integration:
- `buildModuleGraph(rootDir, { silent, overrides })` → returns `ModuleGraph` without side effects
- `compile(rootDir, buildConfig)` → accepts `{ silent, logger }` options
- `emit(graph, options)` → returns result without printing
- `renderPage(graph, ctx)` → already clean, returns `{ html, files, copies, hashMap }`
- The `app` object should have `build()` that returns a Promise, no console output

## Detailed Import Map (Post-Refactor)

### Core imports (compiler → compiler, parser → parser)
- `compiler/index.js` ← `compiler/config.js`, `compiler/module-graph.js`, `compiler/utils.js`, `compiler/chalk.js`, `utils.js` (core)
- `compiler/module-graph.js` ← `compiler/config.js`, `compiler/pipeline.js`, `parser/index.js`, `utils.js` (core), `compiler/dom-processor.js`
- `compiler/render.js` ← `compiler/dom-processor.js`, `compiler/component-processor.js`, `compiler/runtime-generator.js`, `compiler/utils.js`, `parser/index.js`, `compiler/pipeline.js`, `utils.js` (core)
- `compiler/component-processor.js` ← `parser/index.js`, `compiler/utils.js`, `compiler/chalk.js`, `utils.js` (core)
- `compiler/dom-processor.js` ← `utils.js` (core), `compiler/fs.js`
- `compiler/pipeline.js` ← `compiler/utils.js`, `compiler/fs.js`
- `compiler/fs.js` ← `compiler/utils.js`
- `compiler/runtime-generator.js` ← `compiler/utils.js`
- `compiler/utils.js` ← `compiler/chalk.js`
- `compiler/chalk.js` — standalone

### Metaframework imports (metaframework → core)
- `metaframework/dev/index.js` ← `../../compiler/index.js`, `../../compiler/chalk.js`, `../../compiler/config.js`, `../utils.js` (metaframework)
- `metaframework/server/index.js` ← `../../compiler/index.js`, `../../compiler/chalk.js`, `../../compiler/module-graph.js`, `../../compiler/render.js`, `../../compiler/config.js`, `../utils.js` (metaframework)
- `metaframework/bin/chocola.js` ← `../../compiler/index.js`, `../../compiler/chalk.js`, `../../compiler/config.js`, `../utils.js` (metaframework), `../dev/index.js`, `../server/index.js`
- `metaframework/utils.js` ← `../../compiler/chalk.js`, `../../compiler/utils.js`

### Test imports (tests → core + metaframework)
- `tests/compiler.test.js` ← `../compiler/index.js`, `../compiler/utils.js`
- `tests/server.test.js` ← `../metaframework/server/index.js`, `../compiler/utils.js`
- `tests/cli.test.js` ← `../metaframework/bin/chocola.js`
- `tests/config.test.js` ← `../metaframework/utils.js`, `../compiler/config.js`, `../compiler/module-graph.js`, `../compiler/index.js`

### Bench imports (bench → core)
- `bench/worker.js` ← `../compiler/index.js`, `../compiler/config.js`, `../compiler/pipeline.js`, `../compiler/module-graph.js`, `../compiler/dom-processor.js`, `./fixtures.js`
- `bench/index.js` — check for metaframework imports

## Core API for Vite Consumption

The cleaned core should expose these public APIs:

```js
// Core library usage
import { buildModuleGraph, renderPage, emit, compile } from 'chocola/compiler';
import { ChocolaComponent } from 'chocola/runtime';
import { parseScript, computeReachable } from 'chocola/parser';

// For Vite plugin:
const graph = await buildModuleGraph(rootDir, { silent: true, overrides: config });
const result = await renderPage(graph, ctx);
await emit(graph, { ctx });
```

No `console.log`, no `process.env` checks, no `chalk` in the core pipeline. All output is optional via a `logger` parameter.
