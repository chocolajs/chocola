---
title: Compiler flow
description: How the Chocola compiler works internally
---

## Summary

The process starts at the entry point and then moves through eight stages. Each stage produces output which is then used by the next one. You can scan the summaries below to get the whole flow and then dive into code details only where you need to.

1. [Configuration loads project settings](#1-configuration) so later stages know where to find sources and where to write output.
2. [Graph build creates an in-memory map](#2-graph-build) of pages, components, and assets without writing to disk.
3. [Inventorying of available components](#3-component-discovery) from the components directory.
4. [DOM processing parses the source page](#4-dom-processing) and validates the app container while handling page-level conditionals.
5. [Component processing expands and scopes each component](#5-component-processing) inside the app container.
6. [Runtime generation prepares browser scripts](#6-runtime-generation) that power client-side interactivity.
7. [Asset processing collects stylesheets, icons, and scripts](#7-asset-processing) and assigns stable hashed filenames.
8. [Output writes the final site to disk](#8-output) or keeps it in memory for the SSR server to serve.

## Entry point

The compiler can be used from three public entry points depending on the workflow. For a static build you call the build function with a project directory. For local development you start the dev server, which adds hot reload on top of the same pipeline. For production server rendering you create a request handler that reuses the compiled graph. Each of these is a thin wrapper which then delegates to the internal pipeline described below.

#### How it works

* The static build is exposed as `app.build` from `chocola/compiler`. This function is implemented in `compiler/index.js` and it orchestrates the full pipeline.
* For advanced use the same package also exports `buildModuleGraph` and `renderPage` and `emit`. These let you run graph building and rendering separately.
* The dev entry point is `dev.server` from `chocola/dev`. It wraps the compiler with a file watcher.
* The SSR entry point is `createHandler` and `createServer` and `serve` from `chocola/server`. These are implemented in `server/index.js`. See also the [Output](#8-output) section and the SSR server documentation.

## Compilation Pipeline

### 1. Configuration

This stage loads project settings so the rest of the pipeline knows where to find sources and where to write output. It takes the project root as input and produces a normalized configuration with absolute paths. Getting this right early avoids path errors in every later stage.

#### How it works

The settings are read from `chocola.config.json` in the project root. This is handled by `loadConfig` in `compiler/config.js`, which uses helpers in `utils.js` to read the file.

If no config file is present, defaults are applied. The defaults include `srcDir` as `src`, `outDir` as `dist`, `libDir` as `lib` inside the source directory, and `emptyOutDir` as `true` to clean the output before a build.

After that, `resolvePaths` in the same module turns the directory names into absolute paths. This result is then passed to graph building.

| Key | Default | Description |
|---|---|---|
| `srcDir` | `"src"` | Source directory |
| `outDir` | `"dist"` | Output directory |
| `libDir` | `"lib"` | Components directory (inside `srcDir`) |
| `emptyOutDir` | `true` | Whether to clean output before build |

### 2. Graph Build

This stage creates an in-memory map of pages, components, and assets without writing anything to disk. It discovers what exists in the file system and records how pages depend on components and how components depend on each other. This map becomes the shared foundation which is then used for both static builds and server rendering.

#### How it works

The main function is `buildModuleGraph` in `compiler/module-graph.js`.

It starts by loading configuration and resolving paths, as described above. After that it loads the source index file, which is `index.html` inside the source directory, as the page module.

It then discovers and parses all component modules found under `src/lib`. For each component it also adds asset modules for local stylesheets and icons and scripts that the page references.

Edges are recorded to show relationships. The page depends on components, and components may depend on child components. These links are found by looking for tag usage and for import statements of the form `import X from "..."`.

Compiled artifacts are stored per module. This includes a scoped CSS hash and a stable runtime id and parsed props and functions. Once the graph is ready, the legacy `compile` helper simply calls `emit` with the result of `buildModuleGraph`.

### 3. Component Discovery

This stage builds an inventory of every component available to the project. It takes the components directory as input and produces a map from normalized file names to raw HTML strings. This inventory is needed so later stages can match tags to component definitions.

#### How it works

The work is done by `getComponents` in `compiler/pipeline.js`.

This function reads all files with an `html` extension in the components directory. For each file it loads the content as a raw HTML string.

It returns three collections. The first is `loadedComponents`, which is a map from lowercased file names to raw HTML. The second is `componentsLib`, which lists the file names that were found. The third is `emptyComps`, which lists empty files that triggered a warning on load.

### 4. DOM Processing

This stage turns the source index file into a DOM that can be transformed. It validates that the page has the expected root container and evaluates page-level conditionals so the rest of the pipeline sees the correct structure. It also extracts the lists of elements and assets that need further handling.

#### How it works

DOM creation is handled by `createDOM` in `compiler/dom-processor.js`. This function uses `parseHTML` from linkedom to parse the index file, after first protecting curly braces so they are not mistaken for markup.

Validation is performed by `validateAppContainer` in the same module, which checks that an `app` element exists. After that, page-level conditionals are evaluated. This is handled by `processPageConditionals` in `compiler/render.js`, which walks the children of the `app` element and recurses into remaining descendants.

These conditionals include `if` and `mount:if` and `elif` and `else` attributes. They are evaluated against the per-request context, which combines query parameters and middleware results. This means that `props` interpolation and mount conditions can vary per request.

Finally, two helpers collect what remains. `getAppElements` gathers descendant elements inside `app` for component processing, and `getAssetLinks` gathers link elements for asset processing.

### 5. Component Processing

This stage expands every element inside the app container into its final HTML. It matches tags to components, handles slots and conditionals and interpolation, scopes styles, and prepares runtime hooks. This is the most involved stage, which then hands off a fully expanded DOM to runtime and asset handling.

#### How it works

Processing is orchestrated by `processAllComponents` in `compiler/component-processor.js`, which calls `processComponentElement` for each element.

The steps for a single element are as follows.

1. **Match.** The processor checks whether the tag name corresponds to a loaded component. This lookup uses the map built during discovery.

2. **Context.** It extracts element attributes as a context object. This context is then used for interpolation and conditionals.

3. **Chain validation.** It validates conditional chains on slot content and on the component body separately. The attributes involved are `if` and `elif` and `else` and `mount:if`. If the structure is invalid, it throws an error that includes the file location.

4. **Template.** It renders the component body through a DOM fragment created with linkedom.

5. **Slots.** It replaces `slot` elements with the original inner HTML of the usage site. This allows component authors to define insertion points.

6. **Interpolation.** It evaluates expressions wrapped in curly braces inside element attributes. Reserved attributes and those prefixed with `bind:` are excluded. This step uses evaluation with the current context. Text-node interpolation is handled separately by `interpolateNode` after conditionals have been resolved.

7. **Conditionals.** It evaluates conditional attributes on the element. The behavior is as follows. `if` hides the element with `display: none` when the expression is falsy. `mount:if` removes the element entirely when falsy. `elif` provides an alternative condition in a chain. `else` provides the fallback. Chains are tracked per parent in a map called `condChain`. An `else` closes the chain, while a non-conditional element resets it. An `elif` or `else` without a preceding `if` or `mount:if` throws an error.

8. **Void elements.** The special tag `void` acts as a transparent conditional wrapper that never renders itself. A `void` with an `if` renders its children unwrapped when truthy. Similarly, `void` supports `elif` and `else` for chain-aware branching, and a bare `void` always renders its children unwrapped, similar to a fragment.

9. **Import scanning.** The processor scans the component `script` block for import statements of the form `import X from "./Y.html"`. For each match it resolves the imported component by basename. This is then handled by `generateCSRClass` in the same module, which produces a CSR subclass for the imported component. The import line is then stripped from the script.

10. **Runtime id.** If the component has a `script` block and at least one element root, the processor assigns a deterministic attribute named `chid`. The value is derived from the component name and its index, hashed as `chid-<hash>`, and placed on the first element root.

11. **CSS scoping.** Every component receives a deterministic hash class on its root element, derived from the component filename. If the component has a `style` block, its selectors are rewritten to be scoped under that class. Simple selectors such as `.foo` generate both an AND-scoped variant and a descendant-scoped variant. Selectors that contain combinators use descendant scoping only. Selectors for `root` and `root` with a class are scoped to the root element only.

12. **Runtime chunk.** For components that need client execution, a runtime call is generated. The call looks like `r_<hash>(el, ctx)` where the function id is a stable per-module hash of the component filename. This call is injected so the browser can re-run logic after load.

13. **CSR class.** If the component defines a `$runtime` function and a CSR class has not already been generated via import scanning, the compiler generates a subclass of `ChocolaComponent`. This enables dynamic instantiation in the browser. The class name is derived from the filename with the first letter capitalized, or from the import identifier when triggered by an import statement.

14. **Recursion.** The processor then handles nested components inside the current component. Cycle detection is performed via `renderChain` to prevent infinite recursion.

### 6. Runtime Generation

This stage prepares the JavaScript that will run in the browser. It takes the base class and any generated component classes as input and produces script files ready to be included in the output. Without this stage, interactive components would have no client-side behavior.

#### How it works

The base class source is read from `runtime/index.js`. This reading happens in `compiler/render.js` using a URL relative to that module, and the content is passed in as `csrSource`.

Generation itself is handled by `generateRuntimeScript` in `compiler/runtime-generator.js`. This function strips the `export` statement because the output is a non-module script where the class is globally accessible.

The function can return up to three file descriptors, each named `run-<hash>.js` where the hash is derived from the file content using `deterministicHash`. The three kinds are the base class when source is present, the CSR subclasses when any exist, and the SSG `DOMContentLoaded` chunks when components have runtimes. These descriptors are then written to the output directory by `emit` in `compiler/index.js`.

#### 6a. CSR class generation

This sub-step explains how a single CSR class is produced. It takes a component name as input and produces a class definition that extends the base component.

#### How it works

The logic lives in `generateCSRClass` in `compiler/component-processor.js`.

First it loads the component instance from `loadedComponents` using the lowercased filename. It then parses the raw HTML with linkedom to extract the `script` and `template` and `style` sections.

Next it extracts prop defaults and the `$runtime` function if one exists. When a runtime is present, it injects prop variable declarations with defaults, along with top-level variable declarations and helper function definitions, before the runtime body. It then rewrites the function signature to `function(self, ctx)`.

After that it assigns or reuses a deterministic CSS hash for the component and scopes and collects any styles. Finally it emits a class definition of the form `class X extends ChocolaComponent` with a constructor that calls `super` using the template and hash and props and optional runtime and children. The definition is stored in `cx.csrClasses` keyed by the lowercased filename. When triggered by an import statement, the class name respects the original import casing, for example `import CommonButton from "./CommonButton.html"` produces `class CommonButton`.

### 7. Asset Processing

This stage gathers all static assets referenced by the page and components. It assigns stable filenames based on content hashes and updates references in the DOM. It does not write files yet. Instead it collects descriptors which are then handed to the output stage.

#### How it works

Asset helpers live in `compiler/dom-processor.js` and `compiler/pipeline.js`. These functions mutate the DOM but only collect descriptors of the form `{ path, content }` for files and `{ from, to }` for copies.

Stylesheets are handled by `processStylesheet` in `compiler/pipeline.js`. This function reads each local CSS file and assigns a deterministic filename of the form `css-<hash>.css` where the hash is derived from the content. It then updates the `link` href in the DOM.

Icons are handled by `processIcons` in the same module, which stages icon files for copying to the output directory.

Scoped component CSS is collected as `sc-<hash>.css` where the hash comes from `deterministicHash`. A `link` element for this file is then appended to the document head via `appendStylesheetLink` in `compiler/dom-processor.js`.

Scripts are handled by `processScript` in `compiler/pipeline.js`. This function reads each local script file referenced by a `script src` attribute and assigns a filename of the form `js-<hash>.js` based on the content. It rewrites the `src` attribute while preserving inline content and other attributes.

Static assets are handled by `copyStaticDir` in `compiler/pipeline.js`, which stages the `src/static` directory for copying to the output directory.

### 8. Output

This stage produces the final result that users see. For a static build it writes HTML and assets to disk. For server rendering it keeps the same data in memory so it can be served per request. In both cases it takes the rendered DOM and the collected file and copy descriptors as input.

#### How it works

The main function is `emit` in `compiler/index.js`.

During rendering, runtime `script` tags are appended to the document body via `appendRuntimeScript` in `compiler/dom-processor.js`. The final HTML is then serialized via `serializeDOM` in the same module, which restores curly-brace placeholders.

If `emptyOutDir` is enabled, `emit` clears the output directory first. After that it writes `index.html` and every collected CSS and JS file descriptor to the output directory. It then executes copy operations for icons and static assets, and writes the component hash map to `.chocola/hashes.json` for debugging reference.

When running under `chocola/server`, the same data that `renderPage` returns, namely `html` and `files` and `copies` and `hashMap`, is used differently. Instead of writing to disk, the server keeps these virtual assets in memory and serves them with caching headers such as `ETag` and `Last-Modified` and with `gzip` compression, without touching the file system.

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
  ├─ runtime-generator.js → generateRuntimeScript — returns run-<hash>.js descriptors for the base class, CSR classes, and SSG calls
  └─ .chocola/hashes.json → component-to-hash reference map (written after build)

server/index.js           → createHandler/createServer/serve — per-request renderPage(graph, ctx) with ETag/gzip, middleware, static serving
```

## Key Concepts

- **Components**: Single-file `.html` components with `<template>`, `<script>`, and `<style>` sections
- **File-based loading**: `.html` component files are loaded as raw strings and parsed by the compiler
- **CSS Scoping**: Component styles are scoped by rewriting selectors under a deterministic hash class derived from the component filename. The hash class is always present on every component's root element, even without styles, serving as a stable component identifier. Both root and descendant matching via dual selectors (AND + descendant).
- **Hash reference map**: `.chocola/hashes.json` is written after each build, mapping component filenames to their hash classes for debugging. It is auto-generated and should be gitignored.
- **Runtime scripts**: Components with a `$runtime` function get a unique `chid` and a runtime call of the form `r_<hash>(el, ctx)` that re-runs the `$runtime` function on `DOMContentLoaded`
- **Client-Side Rendering (CSR)**: The `ChocolaComponent` base class (`runtime/index.js`) allows dynamic component instantiation in the browser via `mount`, `remove`, and `update` methods. It supports `bind:*` attributes, conditionals, slots, expression interpolation, and automatic event-listener cleanup.
- **Component imports**: Component `<script>` blocks can use `import X from "./Y.html"` syntax. The compiler resolves these imports to known components, generates CSR subclasses for them, and strips the import lines from the build output. Imported components can be instantiated with `new X().mount(target, props)` in the `$runtime` function.
- **CSR class naming**: When triggered by an `import` statement, the generated class matches the imported identifier casing (for example `import CommonButton` produces `class CommonButton`). When generated from HTML tag usage, the name is derived from the filename with only the first letter capitalized.
- **Conditional chains**: `if` and `mount:if` and `elif` and `else` form sibling chains tracked per-parent; validated structurally before rendering with file location (line included when the error is within the same source file)
- **Void elements**: `<void>` acts as a transparent wrapper that never renders itself; useful for conditional rendering without extra DOM nodes
