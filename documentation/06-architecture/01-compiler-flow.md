---
title: Compiler flow
description: How the Chocola compiler works internally
---

## Summary

The compiler is a pure, in-memory pipeline. It starts from a required `.chjs` entry and produces a fragment, scoped CSS, and ESM runtime descriptors. A host handles configuration files, routing, document assembly, asset bundling, and output writing.

1. [Configuration normalization](#1-configuration) applies the few core defaults.
2. [Graph build](#2-graph-build) reads the root `.chjs` and follows imports.
3. [Module parsing](#3-module-parsing) splits sections and records imports, templates, scripts, and styles.
4. [Render](#4-render) resolves components per module, applies conditionals and slots, interpolates values, and scopes CSS.
5. [Runtime generation](#5-runtime-generation) emits deterministic ESM descriptors.
6. [Host output](#6-host-output) writes/serves the result and assembles the document.

## Entry points

`compiler/index.js` exports the complete public API:

```js
export async function buildModuleGraph(rootDir, { entry, config } = {});
export async function render(graph, ctx = {});
export async function compile(rootDir, { entry, config, ctx } = {});
```

Rules:

- `rootDir` is required and must be absolute.
- `entry` is required, relative to `rootDir` (absolute is also accepted), and must end in `.chjs`.
- `compile` is `render(await buildModuleGraph(rootDir, options), options.ctx)`.
- There is no implicit `index.chjs` lookup.

## Compilation Pipeline

### 1. Configuration

`normalizeConfig(config)` only defaults `treeShakeRuntime` to `true` and otherwise leaves the object alone. There is no config-file read, no `srcDir`/`libDir`/`outDir`, and no path resolution in core.

The host owns project configuration. Pass any host-specific settings through `config`; core ignores keys it does not use.

### 2. Graph Build

`buildModuleGraph` in `compiler/module-graph.js`:

1. Resolves the root path and reads the root `.chjs`.
2. Parses it with `parseModuleSource`.
3. Resolves every `.chjs` import relative to the importing file.
4. Pushes newly discovered modules onto a queue and repeats until no imports remain.

Module ids are root-relative POSIX paths such as `app.chjs` or `lib/card.chjs`. Non-`.chjs` imports stay in `module.imports` and are never added to the graph.

Namespace imports (`import * as Lib from "./lib/"`) eagerly walk the directory and map `<Lib:Card>` / `<Lib:Sub:Thing>` to modules. Prefix collisions, missing files, and unknown tags are compile errors with line information.

### 3. Module Parsing

`parseModuleSource` in `compiler/module-source.js` splits raw sections before any HTML parse:

- `<script>`, `<template>`, and `<style>` may appear in any order;
- self-closing component and `<slot>` tags are expanded for valid HTML parsing;
- curly-brace expressions are protected so `>` and `/` inside them cannot break scanning;
- imports and template tags are scanned from the raw source so casing and line numbers are preserved.

Each module stores `script`, `template`, `styles`, `imports`, `importMap`, `namespaceMap`, `compProps`, and deterministic `cssId` / `fnId` values derived from the module id.

### 4. Render

`render(graph, ctx)` in `compiler/render.js` is pure and creates fresh state per call.

It calls `renderInstance` for the root module. For each module instance, the processor:

1. Resolves tags through the owning module's `importMap` and `namespaceMap`.
2. Builds the render context from usage attributes, the parent context, prop defaults, and top-level declarations.
3. Parses the module template into a fragment.
4. Validates conditional chains and replaces `<slot>` with projected content.
5. Applies conditionals, `bind:*` attributes, and attribute/text interpolation.
6. Recursively renders child components, stopping recursion when a module id is already on the render chain.
7. Adds the scoped CSS attribute to every rendered element and the hash class to the root.
8. Collects scoped CSS and hydration calls.

Script-only modules render nothing: a nested usage is removed, and a root script-only entry produces an empty fragment.

### 5. Runtime Generation

`generateRuntime` in `compiler/runtime-generator.js` is a pure descriptor builder:

```js
generateRuntime({ baseSource, moduleChunks, runtimeCalls });
// -> [{ name, content }, ...]
```

Descriptors are ordered deterministically:

1. **Base chunk** — `runtime/index.js` unchanged, content-hashed as `run-<hash>.js`.
2. **Module chunks** — one per module with a CSR class or `$runtime`, named `run-<deterministicHash("module:" + module.id, 6)>.js`. Each chunk contains the module's preserved non-`.chjs` imports, generated imports for child classes, its exported `$runtime` function, and its `ChocolaComponent` subclass.
3. **DOMContentLoaded chunk** — only when at least one component hydrates. It imports runtime functions and calls them with the matching `chid`.

Canonical class names are `PascalCase(basename) + "_" + hash(module.id, 4)`. Import aliases preserve the local names used by each parent module.

### 6. Host output

The core stops at descriptors. It does not:

- read `chocola.config.json`;
- discover components;
- parse or assemble an `index.html`;
- copy static assets;
- write files;
- write `.chocola/hashes.json`.

The host receives `{ html, styles, runtime, hashMap }`, writes or serves those values, and wraps `html` in its own document.

## Data Flow Diagram

```
runtime/index.js          → self-contained ChocolaComponent base class (browser-safe)

compiler/index.js
  ├─ config.js            → normalizeConfig — pure defaults
  ├─ module-graph.js      → ChocolaModule, ModuleGraph, buildModuleGraph (imports only)
  ├─ module-source.js     → raw section splitting, self-closing expansion, tag scanning
  ├─ tags.js              → static tag classification and suggestions
  ├─ render.js            → render(graph, ctx) — pure fragment + styles + runtime + hashMap
  ├─ component-processor.js → ProcessContext, renderInstance, generateCSRClass, buildModuleChunks
  ├─ dom-processor.js     → createRenderDocument, parseFragment, serializeFragment
  ├─ runtime-generator.js → generateRuntime — base, module, and DOMContentLoaded chunks
  └─ utils.js             → deterministic hashes and source-line lookup

hosts (e.g. ChocolaKit)   → config, routing, document assembly, asset bundling, output, hash persistence
```

## Key Concepts

- **Components**: single-file `.chjs` modules with optional `<template>`, `<script>`, and `<style>` sections.
- **Import-based loading**: a module enters the graph only when another `.chjs` module imports it, or when a namespace directory import reaches it.
- **Module-scoped resolution**: each template resolves tags against the imports of the module that owns it, not a global component map.
- **CSS scoping**: every element carries a per-module `data-sc-<hash>` attribute, and selectors are rewritten to require it. Styles cannot leak into nested components.
- **Deterministic hashes**: CSS ids, runtime function ids, class names, and chunk names all derive from the module id, not traversal order.
- **Runtime scripts**: components with `$runtime` get a `chid` on their root element and a hydration call in the DOMContentLoaded chunk.
- **Client-side rendering**: each module chunk exports a `ChocolaComponent` subclass usable via `mount`, `update`, and `remove`.
- **Conditional chains**: `if`, `mount:if`, `elif`, and `else` form sibling chains tracked per parent and validated before rendering.
- **Void elements**: `<void>` acts as a transparent wrapper that never renders itself.
