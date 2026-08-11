---
title: Compiler flow
description: How the Chocola compiler works internally
---

## Entry Point

**`chocola/compiler`** — the public API. Import `{ app }` from `"chocola/compiler"` and call `app.build(rootDir)`, which delegates to `compiler/index.js`.

**`chocola/dev`** — the dev server API. Import `{ dev }` from `"chocola/dev"` and call `dev.server(rootDir)`.

## Compilation Pipeline

### 1. Configuration (`compiler/config.js`)

`loadConfig(rootDir)` reads `chocola.config.json` (via `utils.js`) and merges with defaults:

| Key | Default | Description |
|---|---|---|
| `srcDir` | `"src"` | Source directory |
| `outDir` | `"dist"` | Output directory |
| `libDir` | `"lib"` | Components directory (inside `srcDir`) |
| `emptyOutDir` | `true` | Whether to clean output before build |


`resolvePaths()` resolves absolute paths for `outDir`, `src`, and `components`.

### 2. Graph Build (`compiler/module-graph.js`)

`buildModuleGraph(rootDir)` performs discovery and parsing without writing anything:

- Loads config and resolves paths
- Loads the source index file (`index.html` from `srcDir`) as the page module
- Discovers and parses all components from `src/lib/` as component modules
- Adds asset modules for local stylesheets, icons, and scripts referenced by the page
- Records edges: page → components → child components (tag usage + `import X from "..."`), plus asset links
- Compiled module artifacts (scoped CSS hash, stable runtime id, parsed props/functions) are stored per module

`compile()` now reduces to `emit(buildModuleGraph())`.

### 3. Component Discovery (`compiler/pipeline.js`)

`getComponents(libDir)`:
- Reads all `.html` files in the components directory
- Loads each file as a raw HTML string
- Returns `{ loadedComponents, componentsLib, emptyComps }` — `loadedComponents` is a `Map<lowercase-filename, raw HTML string>`; `componentsLib` lists the file names; `emptyComps` lists empty files (warned about on load)

### 4. DOM Processing (`compiler/dom-processor.js`)

- Creates a DOM from the index file using linkedom's `parseHTML` (curly braces protected first)
- Validates an `<app>` root element exists
- Evaluates page-level conditionals (`if`/`mount:if`/`elif`/`else`) on the children of `<app>` via `processPageConditionals` (defined in `compiler/render.js`, recursing into remaining descendants) — these run in a page context, not a component context
- Extracts all descendant elements inside `<app>` for component processing
- Extracts `<link>` elements (stylesheets, icons) for asset processing

### 5. Component Processing (`compiler/component-processor.js`)

For each element inside `<app>`:

1. **Match** — checks if tag name corresponds to a loaded component
2. **Context** — extracts attributes as context
3. **Chain validation** — validates `if`/`elif`/`else`/`mount:if` structure on both slot content and component body separately, throwing with file location on violation
4. **Template** — renders component body via a DOM fragment (linkedom)
5. **Slots** — replaces `<slot>` elements with the original inner HTML
6. **Interpolation** — evaluates `{expr}` in element attributes (reserved and `bind:` attributes excluded) using `with(ctx)`; text-node `{expr}` is interpolated separately by `interpolateNode` after conditionals
7. **Conditionals** — evaluates `if`, `mount:if`, `elif`, `else` attributes
   - `if={expr}` — hides element (`display: none`) when falsy
   - `mount:if={expr}` — removes element when falsy
   - `elif={expr}` — alternative condition in a chain
   - `else` — fallback in a chain
   - Chained via `condChain` state tracked per-parent in a `Map`
   - `else` closes the chain; non-conditional elements reset it
   - `elif`/`else` without a preceding `if`/`mount:if` throws an error
8. **Void elements** — `<void>` is a transparent conditional wrapper:
   - `<void if={expr}>` — renders children unwrapped when truthy
   - `<void elif={expr}>` — chain-aware alternative
   - `<void else>` — chain-aware fallback
   - `<void>` — always renders children unwrapped (fragment-like)
9. **Import scanning** — scans component `<script>` for `import X from "./Y.html"` statements. For each match, resolves the imported component by basename, calls `generateCSRClass()` to produce a CSR subclass for it, and strips the import line from the script.
10. **Runtime ID** — if the component has a `<script>` and at least one element root, assigns a unique `chid` attribute to the first element root
11. **CSS Scoping** — every component gets a deterministic hash class on its root element derived from the component filename. If the component has `<style>`, the selectors are rewritten under that class:
    - Simple selectors (`.foo`) generate both AND-scoped (`.cssId.foo`) and descendant-scoped (`.cssId .foo`) variants
    - Selectors with combinators use descendant scoping only
    - `:root` and `:root.class` scope to the root element only
12. **Runtime Chunk** — generates a runtime function call: `r_<hash>(el, ctx)` (the function id is a stable per-module hash of the component filename)
13. **CSR Class** — if the component has a `$runtime` function and a CSR class hasn't already been generated (e.g., via import scanning), generates a `ChocolaComponent` subclass for client-side dynamic instantiation. The class name is derived from the filename (first letter capitalized), or from the import identifier when triggered by an `import` statement.
14. **Recursion** — processes nested components within the current component (with cycle detection via `renderChain`)

### 6. Runtime Generation (`compiler/runtime-generator.js`)

- The base class source is read from `runtime/index.js` in `compiler/render.js` (`new URL("../runtime/index.js", import.meta.url)`) and passed in as `csrSource`
- `generateRuntimeScript` strips the `export` statement (output is a non-module script so the class is globally accessible)
- Returns up to three `run-<random>.js` file descriptors — the base class (when `csrSource` is present), CSR subclasses (when any exist), and SSG `DOMContentLoaded` chunks (when components have runtimes) — which `compiler/index.js` `emit()` writes to the output directory

### 6a. CSR Class Generation (`compiler/component-processor.js` — `generateCSRClass`)

Produces a `ChocolaComponent` subclass for any loaded component by name:

1. Loads the component instance (raw HTML) from `loadedComponents`
2. Parses with linkedom to extract `<script>`, `<template>`, `<style>`
3. Extracts props defaults and the `$runtime` function (if any)
4. If `$runtime` exists: injects prop variable declarations (with defaults), top-level variable declarations, and top-level helper function definitions before the runtime body, then rewrites the function signature to `function(self, ctx)`
5. Assigns or reuses a deterministic CSS hash for the component
6. Scopes and collects styles
7. Emits a class definition: `class X extends ChocolaComponent { constructor() { super({ template, hash, props, runtime?, children? }) } }`
8. Stores the class definition in `cx.csrClasses` keyed by lowercased component filename

The class name respects the original import casing when triggered by an `import` statement (e.g., `import CommonButton from "./CommonButton.html"` produces `class CommonButton`). When generated from HTML tag usage, the name is derived from the filename with only the first letter capitalized.

### 7. Asset Processing (`compiler/dom-processor.js` + `compiler/pipeline.js`)

Asset functions mutate the DOM but never write — they collect `{ path, content }` file and `{ from, to }` copy descriptors that `emit()` writes:

- **Stylesheets** — reads local CSS files, assigns random filenames, updates `<link>` hrefs
- **Icons** — stages icon files for copying to output
- **Scoped CSS** — collects component-scoped CSS as `sc-<random>.css`, appends `<link>` to document head
- **Scripts** — reads local `<script src>` files, assigns random filenames, rewrites the `src` attribute (preserving inline content and other attributes)
- **Static assets** — stages the `src/static/` directory for copying to the output directory

### 8. Output (`compiler/index.js` — `emit(graph)`)

- Appends runtime `<script>` tags to document body (during render)
- Serializes the final HTML (restoring curly-brace placeholders) (during render)
- Clears the output directory if `emptyOutDir` is enabled
- Writes `index.html` and every collected CSS/JS file descriptor to the output directory
- Executes copy operations (icons, static assets)
- Writes component hash map to `.chocola/hashes.json` for debugging reference

## Data Flow Diagram

```
runtime/index.js          → Self-contained ChocolaComponent base class (no parser imports, browser-safe)

compiler/index.js
  ├─ config.js            → loadConfig + resolvePaths
  ├─ module-graph.js      → ChocolaModule, ModuleGraph, buildModuleGraph (discovery + parsing, no writes)
  ├─ render.js            → renderPage(graph, ctx) — pure render { html, hashMap, files, copies }, processPageConditionals
  ├─ pipeline.js          → getComponents, getSrcIndex, processStylesheet, processIcons, processScript, copyStaticDir
  ├─ dom-processor.js     → createDOM, validateAppContainer, getAppElements, getAssetLinks, getScriptElements,
  │                          appendStylesheetLink, serializeDOM, writeHTMLOutput, appendRuntimeScript
  ├─ component-processor.js → processAllComponents, processComponentElement, generateCSRClass (CSR subclass generation)
  ├─ parser/index.js      → validateChainStructure (template.js), scopeCss (css.js), compileExpr,
  │                          conditional evaluation, interpolation, props/runtime extraction
  ├─ runtime-generator.js → generateRuntimeScript — returns run-*.js descriptors for the base class, CSR classes, and SSG calls
  └─ .chocola/hashes.json → component-to-hash reference map (written after build)
```

## Key Concepts

- **Components**: Single-file `.html` components with `<template>`, `<script>`, and `<style>` sections
- **File-based loading**: `.html` component files are loaded as raw strings and parsed by the compiler
- **CSS Scoping**: Component styles are scoped by rewriting selectors under a deterministic hash class derived from the component filename. The hash class is always present on every component's root element, even without styles, serving as a stable component identifier. Both root and descendant matching via dual selectors (AND + descendant).
- **Hash reference map**: `.chocola/hashes.json` is written after each build, mapping component filenames to their hash classes for debugging. It is auto-generated and should be gitignored.
- **Runtime scripts**: Components with a `$runtime` function get a unique `chid` and a runtime call (`r_<hash>(el, ctx)`) that re-runs the `$runtime` function on `DOMContentLoaded`
- **Client-Side Rendering (CSR)**: The `ChocolaComponent` base class (`runtime/index.js`) allows dynamic component instantiation in the browser via `mount`, `remove`, and `update` methods. It supports `bind:*` attributes, conditionals, slots, expression interpolation, and automatic event-listener cleanup.
- **Component imports**: Component `<script>` blocks can use `import X from "./Y.html"` syntax. The compiler resolves these imports to known components, generates CSR subclasses for them, and strips the import lines from the build output. Imported components can be instantiated with `new X().mount(target, props)` in the `$runtime` function.
- **CSR class naming**: When triggered by an `import` statement, the generated class matches the imported identifier casing (e.g., `import CommonButton` → `class CommonButton`). When generated from HTML tag usage, the name is derived from the filename with only the first letter capitalized.
- **Conditional chains**: `if`/`mount:if`/`elif`/`else` form sibling chains tracked per-parent; validated structurally before rendering with file location (line included when the error is within the same source file)
- **Void elements**: `<void>` acts as a transparent wrapper that never renders itself; useful for conditional rendering without extra DOM nodes
