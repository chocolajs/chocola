- Status: proposed — no code changes yet
- RFC: [`chocolajs/rfcs#0004`](https://github.com/chocolajs/rfcs/blob/main/text/0004-import-based-component-graph.md)
- Issue: [`chocolajs/chocola#209`](https://github.com/chocolajs/chocola/issues/209)
- Target: `chocola` core (`compiler/`, `parser/`, `runtime/`)

# Implementation plan: import-based component graph (RFC 0004)

## 1. Summary

RFC 0004 turns the compiler from a project compiler into a pure transform:

- one root `.chjs` component plus the `.chjs` modules it imports;
- `.html` components and directory discovery are removed;
- a template tag must be a static HTML/SVG/MathML/custom element or an imported component;
- the compiler never reads `chocola.config.json`, never writes output, and never assembles a document;
- `render()` returns `{ html, styles, runtime, hashMap }` in memory;
- imports resolve relative to the importing file, with namespace imports supported;
- self-closing component tags are normalized before `linkedom` sees the template.

This plan follows the RFC's **resolved questions** where they differ from the earlier prose. In particular:

| Topic | RFC prose | Resolved decision used here |
|---|---|---|
| Graph entry | `buildModuleGraph(rootComponentPath, { config })` | `buildModuleGraph(rootDir, { entry, config })` |
| Namespace imports | out of scope in the first iteration | supported as `<Ns:Component>` / `<Ns:Subdir:Component>` |
| `hashMap` | optional debug aid | kept, keyed by module id |
| Non-`.chjs` imports | host concern | preserved verbatim as ESM in generated JS |
| Script-only `.chjs` | not specified | valid; renders nothing |
| `treeShakeRuntime` | cross-module reachability | intra-module `$runtime` extraction only |

The plan also makes one implementation refinement that the RFC leaves open: generated client code is emitted as **one ESM chunk per component module** instead of one concatenated class chunk. That is required to preserve non-`.chjs` imports without local-name collisions and to keep same-named components from different folders independent. The public descriptor shape is unchanged: `runtime` is still `{ name, content }[]`.

## 2. Scope

In scope:

- `compiler/index.js`, `config.js`, `module-graph.js`, `render.js`, `component-processor.js`, `dom-processor.js`, `runtime-generator.js`, `pipeline.js`, `tags.js` (new), `module-source.js` (new);
- parser helpers only where needed to scan imports/templates;
- `runtime/index.js` only for namespace-safe child mounting;
- tests, fixtures, bench, docs, changelog;
- public API and migration notes.

Out of scope:

- ChocolaKit implementation changes (documented as a follow-up);
- routing, document assembly, bundling of non-`.chjs` modules, asset copying;
- a codemod for `.html` → `.chjs`;
- cross-module reachability/tree-shaking (RFC resolved question #8);
- a new template parser or XML parsing.

## 3. Current baseline

The current core is pre-RFC:

- `buildModuleGraph(rootDir, { overrides })` reads config, loads `src/index.html`, scans `src/lib/*.html`, and builds a global lowercase component map (`compiler/module-graph.js:198-248`).
- `ChocolaModule.kind` is `"page" | "component" | "asset"`; `compName` is a lowercased basename.
- Template tags resolve through `tag + ".html"` against `graph.loadedComponents` (`compiler/component-processor.js:299-301`).
- `renderPage(graph, ctx)` requires `<app>`, runs page conditionals, processes assets, and returns `{ html, hashMap, files, copies }` (`compiler/render.js:136-183`).
- `emit(graph)` writes `dist/`, copies assets, and writes `.chocola/hashes.json` (`compiler/index.js:19-44`).
- `loadConfig` / `resolvePaths` contain `srcDir`, `libDir`, `outDir`, `emptyOutDir` (`compiler/config.js`).
- `pipeline.js` contains discovery and asset functions.
- Tests, fixtures, docs, and bench all assume `.html`, `src/index.html`, `<app>`, `emit`, and `renderPage`.

Everything above changes. The useful internals to preserve are:

- `parseScript()` import/AST extraction (`parser/script.js`);
- `protectCurlyBraces()` / `restoreCurlyBraces()` (`utils.js`);
- conditional chains (`if`, `mount:if`, `elif`, `else`, `<void>`);
- slot projection;
- scoped CSS (`scopeCss`, `scopeAttribute`);
- `$runtime` extraction and intra-module reachability;
- deterministic hashes (`deterministicHash`, `runtimeFunctionId`);
- `ChocolaComponent` (`runtime/index.js`).

## 4. Target public API

```js
// compiler/index.js
export async function buildModuleGraph(rootDir, { entry, config } = {});
export async function render(graph, ctx = {});
export async function compile(rootDir, { entry, config, ctx } = {});
```

Rules:

- `rootDir` is required and must be absolute.
- `entry` is required; it is relative to `rootDir` (absolute is also accepted). There is no implicit `index.chjs` discovery.
- `rootComponentPath = path.resolve(rootDir, entry)` and it must end in `.chjs`.
- `config` is an optional plain object. `normalizeConfig(config)` only defaults `treeShakeRuntime: true` and otherwise leaves the object alone.
- `compile(rootDir, options)` is `render(await buildModuleGraph(rootDir, options), options.ctx)`.

`render()` returns exactly:

```js
{
  html,       // root component fragment
  styles,     // scoped CSS string, may be ""
  runtime,    // [{ name: "run-<hash>.js", content }]
  hashMap     // { "<moduleId>": "<cssId>" }
}
```

`renderPage`, `emit`, `app`, `setupOutputDirectory`, `writeHTMLOutput`, and `.chocola/hashes.json` are removed. `renderPage` is not kept as an alias in this plan; if maintainers want a one-release bridge, add a deprecation wrapper that calls `render`, but do not keep page/document semantics in it.

## 5. Target data model

```js
class ChocolaModule {
  id;             // root-relative posix path, e.g. "app.chjs", "lib/card.chjs"
  sourcePath;     // absolute path
  isRoot;         // boolean
  source;         // raw file contents, used for line lookups
  script;         // raw <script> contents or null
  template;       // normalized raw <template> contents or null
  styles;         // raw <style> contents or null
  imports;        // parseScript() import records
  importMap;      // Map<lowercased local, module id>
  namespaceMap;   // Map<lowercased prefix, { dir, components: Map<relLower, id>, moduleIds: Set<id> }>
  deps;           // Set<module id>
  compProps;
  topFuncs;
  topVars;
  cssId;          // deterministicHash(id, 8)
  fnId;           // runtimeFunctionId(id)
}

class ModuleGraph {
  rootDir;
  entry;          // module id of the root
  config;         // normalizeConfig(config)
  root;           // ChocolaModule
  modules;        // Map<module id, ChocolaModule>
  moduleById(id);
}
```

Removed fields: `kind`, `compName`, `mtimeMs`, `parsed`, `neededClientImports` (computed at render time), `graph.page`, `graph.components`, `graph.loadedComponents`, `graph.originalComponentNames`.

Hashing always uses `module.id`, never the basename. That is what makes two `card.chjs` files in different folders independent.

## 6. Parsing and template normalization

### 6.1 Raw section splitting

The current code parses the whole `.chjs` source with `parseHTML()` and then reads `script/template/style`. That is not safe for self-closing components: `parseHTML("<A /><B />")` nests `B` inside `A` before we get a chance to normalize.

Add `compiler/module-source.js` with:

```js
splitComponentSource(source)
// -> { script, template, styles }  (raw innerHTML, first block of each kind)
```

Requirements:

- find top-level `<script>`, `<template>`, `<style>` case-insensitively;
- handle attributes on the opening tag;
- quote-aware: ignore `>` inside attribute values;
- track nested `<template>` depth so the outer template is not truncated;
- skip HTML comments;
- do not HTML-parse or rewrite the contents.

### 6.2 Self-closing normalization

`expandSelfClosingComponents(templateSource, { importLocals, namespacePrefixes })`:

- rewrite `<Local ... />` to `<Local ...></Local>` when `Local` matches an imported `.chjs` local;
- rewrite `<Ns:Component ... />` when `Ns` is a namespace prefix;
- rewrite `<slot ... />` to `<slot ...></slot>`;
- leave explicit pairs alone;
- leave static void elements (`<br />`, `<img />`) alone;
- leave hyphenated custom elements alone (RFC resolved question #3);
- skip `<script>`, `<style>`, comments, and attribute values;
- protect curly-brace interpolations with `protectCurlyBraces()` while scanning, then restore, so `<` inside `{a < b}` is never mistaken for a tag.

This pass runs **after** the script has been parsed (to know import locals) and **before** `parseHTML()`.

### 6.3 Tag scanning for the graph

`scanTemplateTags(templateSource)` returns raw start tags with source casing and line:

```js
[{ rawName: "Greeting", lowerName: "greeting", index, line }, ...]
```

It must:

- skip closing tags, comments, doctype, and `script`/`style` regions;
- skip attribute values;
- skip curly-brace interpolations;
- preserve source casing so unknown-component errors and suggestions are useful even though `linkedom` lowercases tags later.

Graph validation uses this scanner, not a parsed DOM. Dependency edges and tag errors therefore share one source of truth and one line-number calculation.

### 6.4 `parseModuleSource`

Centralize the pipeline in `parseModuleSource(module)`:

1. `splitComponentSource(module.source)`.
2. `parseScript(script)` to obtain imports.
3. Build the set of `.chjs` import locals and namespace prefixes.
4. `expandSelfClosingComponents(template, ...)`.
5. Store `module.script`, `module.template`, `module.styles`, `module.imports`.
6. Compute `module.compProps`, `module.topFuncs`, `module.topVars`, `module.cssId`, `module.fnId`.

The graph and the renderer both consume `module.script` / `module.template` / `module.styles`; neither re-parses raw source.

If Acorn fails (`parseScript().ast === null`), keep a conservative import-only regex fallback so graph building still sees imports and the host's bundler can report the original syntax error. Do not silently drop imports.

## 7. Graph construction

Add `compiler/tags.js`:

```js
export const KNOWN_HTML_TAGS = new Set([...]); // HTML + SVG + MathML + template/script/style/slot/void
export function isStaticTag(tagLower) {
  return KNOWN_HTML_TAGS.has(tagLower) || tagLower.includes("-");
}
```

The list is curated (lowercase) and tested against common HTML, SVG, and MathML tags. Hyphenated tags are always static custom elements. `app` is intentionally **not** in the list: documents no longer belong to core.

`buildModuleGraph(rootDir, { entry, config })`:

1. Validate `rootDir` is absolute, `entry` is present, and both resolve to a readable `.chjs` file.
2. Create `ModuleGraph` with `normalizeConfig(config)`.
3. Load the root module (`isRoot: true`) and enqueue it.
4. Breadth-first over unparsed modules:
   - `parseModuleSource(module)`.
   - For each import:
     - If `source` ends in `.chjs`, resolve it relative to `path.dirname(module.sourcePath)`, verify it exists, load it, and add it to `module.deps`.
     - Default and named specifiers register `module.importMap.set(spec.local.toLowerCase(), child.id)`.
     - Side-effect imports add a dep but no tag binding.
     - Namespace specifiers require the resolved source to be a directory; build `module.namespaceMap` (see below).
     - Non-`.chjs` imports stay in `module.imports` and are **not** added to the graph.
   - Scan `module.template` with `scanTemplateTags`:
     - tag in `importMap` → add dep;
     - tag `prefix:path` in `namespaceMap` → resolve and add dep;
     - `isStaticTag(tag)` → leave it;
     - otherwise throw an unknown-component error.
5. Return the graph.

Error messages:

```text
rootDir must be an absolute path (received "...")
entry is required; pass { entry: "<path to root .chjs>" }
entry must point to a .chjs component (received "...")
Cannot resolve import "./missing.chjs" from lib/card.chjs
Unknown component <Greeting> in app.chjs:7. Did you forget to import it?
Unknown component <Lib:Missing> in app.chjs:7. Did you forget to import it?
Namespace import "./lib/" must point to a directory
Namespace prefix <Lib> collides with import <Lib> in app.chjs
```

Suggestions (RFC resolved question #7):

- only for capitalized source tags;
- compare against `importMap` locals and namespace tags;
- Levenshtein distance ≤ 2 or a case-insensitive/prefix match;
- append `Did you mean <Greeting>?` to the error.

### 7.1 Namespace imports

`import * as Lib from "./lib/"`:

- resolve the namespace directory relative to the importing file;
- recursively collect `.chjs` files under it (ignore other extensions);
- map lowercased relative paths without extension: `card` → `lib/card.chjs`, `sub/thing` → `lib/sub/thing.chjs`;
- store `{ dir, components, moduleIds }` in `module.namespaceMap` under `"lib"`;
- add all discovered modules to the graph and to `module.deps`;
- `<Lib:Card />` resolves through `components.get("card")`;
- `<Lib:Sub:Thing />` joins path segments with `/` and resolves `components.get("sub/thing")`;
- `<Lib />` alone is an unknown tag;
- a namespace prefix and a default/named local must not collide;
- two namespace imports with the same prefix from different directories are an error;
- two files that differ only by case are ambiguous and an error.

Eagerly walking a namespace directory is the simplest interpretation of the RFC's `moduleIds` field. It means an unused file inside a namespace directory still enters the graph; that is acceptable and should be documented.

## 8. Config and purity

Replace `compiler/config.js` with:

```js
export function normalizeConfig(config = {}) {
  return { treeShakeRuntime: true, ...config };
}
```

- No `fs`, no `path`, no `chocola.config.json` reading.
- No `srcDir`, `libDir`, `outDir`, `emptyOutDir` semantics.
- Unknown keys are passed through; hosts own their own config.
- `treeShakeRuntime` governs only intra-module `$runtime` extraction, not graph reachability.

`buildModuleGraph` reads `.chjs` source files (necessary), `render` performs no project I/O and never writes. The runtime base-class source may be read once at module load and cached; that is package-internal, not project I/O.

## 9. Rendering

### 9.1 Module-scoped resolution

`ProcessContext` no longer holds `loadedComponents` or `originalNames`. It holds:

```js
{
  graph,
  runtimeChunks,
  compIdColl,
  runtimeMap,       // module id -> { fnId, chunkName }
  cssScopesMap,     // module id -> cssId
  scopedStyles,
  styleModules,     // Set<module id>, to avoid duplicate CSS
  staticCtxRegistry,
  csrClasses,       // Map<`${id}#${className}`, class source>
  classNames,       // Map<module id, canonical class name>
  usedImports,      // Map<module id, preserved non-.chjs import statements>
  treeShakeRuntime
}
```

`resolveModuleForTag(ownerModule, tagLower)`:

```js
if (ownerModule.importMap.has(tagLower)) return graph.moduleById(ownerModule.importMap.get(tagLower));
if (tagLower.includes(":")) {
  const [prefix, ...rest] = tagLower.split(":");
  const ns = ownerModule.namespaceMap.get(prefix);
  if (ns) return graph.moduleById(ns.components.get(rest.join("/")));
}
return null;
```

All old `cx.loadedComponents.has/get(...)` call sites are rewritten to this helper.

### 9.2 `renderInstance`

Extract the per-instance body of `processComponentElement` into:

```js
renderInstance(module, usageElement, cx, renderChain, sourceFile, sourceContent, globalCtx)
```

- `usageElement === null` for the root component, otherwise the tag element at the usage site.
- Root context is `{ ...globalCtx }`; nested context is attributes + global context, as today.
- `sourceFile` / `sourceContent` are the owner module id and template, used only for error locations.
- `renderChain` tracks module ids; if a module id already appears, stop recursing.
- If `module.template` is null, script-only components render nothing: remove the usage element (nested) or return an empty fragment (root).
- Keep conditional ordering: apply conditionals to child component elements **before** rendering them, so `mount:if` does not emit orphaned runtime bindings.
- Use `module.id` for `displayName`, `chid` hashing, warnings, and line locations.
- Use `module.source` for `findElementLine`; template normalization does not add lines.
- Scope the template with `module.cssId`; push scoped CSS once per module.
- Replace `<slot>` with the usage element's children.
- Root serialization uses a fragment serializer, not a whole-document serializer.

`processComponentElement` becomes a thin wrapper that resolves the module and calls `renderInstance`.

### 9.3 Root render

`render(graph, ctx)`:

1. Create a fresh `ProcessContext` and one render document (`linkedom`) per call. No shared mutable render state, so concurrent renders are safe.
2. Call `renderInstance(graph.root, null, cx, [], null, null, ctx)`.
3. Generate CSR classes for all graph modules with templates (recursively as needed), so hosts can still `new Class().mount(...)` for imported components.
4. Generate runtime descriptors.
5. Return `{ html, styles, runtime, hashMap }`.

`html` is the serialized root fragment. It is not a full document and contains no `<html>`, `<head>`, or `<body>`.

## 10. Client output and ESM imports

The RFC requires non-`.chjs` imports to be preserved verbatim as ESM. The current single concatenated class chunk makes that unsafe: two modules can import different `fmt` bindings from different files. Emit one ESM chunk per component module instead.

### 10.1 Runtime descriptor shape

Still `runtime: [{ name, content }]`, but entries are:

1. **Base chunk** (once per render): `runtime/index.js` source unchanged. It already exports `ChocolaComponent`. Name is content-hashed: `run-<hash>.js`.
2. **Module chunk** (one per module with client code), name `run-<deterministicHash("module:" + module.id, 6)>.js`:
   - non-`.chjs` import statements from that module, preserved verbatim;
   - `import { ChocolaComponent } from "./<baseChunk>";` when the module has a CSR class;
   - `import { <CanonicalChildClass> as <ImportLocal> } from "./<childChunk>";` for each `.chjs` import used by the template or runtime;
   - `export function r_<modulehash>(self, ctx) { ... }` when the module has `$runtime`;
   - `class <CanonicalClass> extends ChocolaComponent { ... }` when the module has a CSR class;
   - `export { <CanonicalClass> };`.
3. **DOMContentLoaded chunk** (only when at least one component hydrates), name content-hashed:
   ```js
   import { r_x as __r0 } from "./run-<modulehash>.js";
   document.addEventListener("DOMContentLoaded", () => {
     __r0(document.querySelector('[chid="..."]'), { ... });
   });
   ```

Using module ids for chunk names avoids circular content hashes when components import each other. Hosts should attach their own build/version to served paths if they need cross-build cache busting.

### 10.2 Class names and aliases

- Canonical class name: `PascalCase(sanitized basename) + "_" + deterministicHash(module.id, 4)`.
  This makes two `card.chjs` files in different folders produce different classes.
- Template child mappings use the canonical class or an import alias binding.
- If a parent imports the same module under several locals, the parent chunk emits several aliased imports:
  ```js
  import { Card_a1b2 as Card } from "./run-....js";
  import { Card_a1b2 as Btn } from "./run-....js";
  ```
  User runtime code that says `new Card()` or `new Btn()` keeps working.
- `.chjs` import lines are removed from emitted JS and replaced by generated class imports.
- Side-effect `.chjs` imports add a graph edge; emit `import "./run-<child>.js";` only if the child has a module chunk.

### 10.3 Runtime generation

`compiler/runtime-generator.js` becomes a pure descriptor builder:

```js
generateRuntime({ baseSource, moduleChunks, runtimeCalls })
// -> [{ name, content }, ...]
```

Order is deterministic: base chunk, module chunks sorted by module id, DOMContentLoaded chunk last. `render` never writes these files.

`runtime/index.js` needs one small change: namespace tags contain `:`, which is not a valid bare CSS selector in `querySelectorAll`. Update `#mountChildren` to use a colon-safe lookup (`getElementsByTagName(tag)` or an escaped selector) so `<Ns:Card>` child classes can mount.

## 11. File-by-file changes

| File | Change |
|---|---|
| `compiler/index.js` | New `buildModuleGraph` / `render` / `compile` exports. Remove `emit`, `app`, output setup, `performance` timing. |
| `compiler/config.js` | Replace `loadConfig` / `resolvePaths` with pure `normalizeConfig`. |
| `compiler/pipeline.js` | Delete. Discovery and asset processing are gone. |
| `compiler/module-graph.js` | Rewrite around `.chjs`, imports, namespaces, `tags.js`, and `module-source.js`. Remove page/assets/global maps. |
| `compiler/module-source.js` | New: raw section splitter, self-closing expansion, tag scanner, `parseModuleSource`. |
| `compiler/tags.js` | New: `KNOWN_HTML_TAGS`, `isStaticTag`, suggestion helper. |
| `compiler/render.js` | Replace `renderPage` with pure `render`; delete page conditionals/assets/document assembly. |
| `compiler/component-processor.js` | Module-scoped resolution; extract `renderInstance`; update `generateCSRClass`; remove `loadedComponents`; add used-import collection. |
| `compiler/dom-processor.js` | Keep only `createRenderDocument`, `parseFragment`, `serializeFragment`. Delete app/asset/write helpers. |
| `compiler/runtime-generator.js` | Emit `{ name, content }` descriptors; per-module ESM chunks; preserve imports. |
| `compiler/utils.js` | Keep hashes/line lookup; add Levenshtein helper if not placed in `tags.js`. |
| `compiler/fs.js` | Keep `readMyFile` / `checkFile`. |
| `runtime/index.js` | Colon-safe child mounting only. |
| `parser/*` | No semantic changes expected; keep import/AST helpers. |
| `package.json` | No dependency change. Update description only if maintainers want. |

Dead code to remove after the switch:

- `getComponents`, `getSrcIndex`, `processStylesheet`, `processIcons`, `processScript`, `copyStaticDir`;
- `createDOM`, `validateAppContainer`, `getAppElements`, `getAssetLinks`, `getScriptElements`, `appendStylesheetLink`, `appendRuntimeScript`, `serializeDOM`, `writeHTMLOutput`, `writeCSSOutput`;
- `processPageConditionals`, `processAssets`, `scanComponentDeps`, `scanAssetModules`, `buildReplicaGraph`, `pageScanReplica`;
- all `.html` checks, `.html` basename lookups, and `tag + ".html"` resolution.

## 12. Tests

### 12.1 Fixtures

Replace `tests/fixtures/basic/` with a root-component fixture:

```text
tests/fixtures/basic/
├── app.chjs
└── lib/
    ├── action.chjs
    ├── card.chjs
    ├── counter.chjs
    ├── format.js        # non-.chjs import, must not enter the graph
    ├── greeting.chjs
    └── unused.chjs      # exists on disk, must not be discovered
```

`app.chjs` imports and uses `Greeting`, `Counter`, and `Card`; `card.chjs` imports `Action`; `counter.chjs` imports `{ fmt } from "./format.js"`. `unused.chjs` is not imported. This single fixture proves import-only discovery, nested imports, slot projection, non-`.chjs` import preservation, and the absence of `src/index.html`, `<app>`, config, and assets.

Add `mkTmpApp(files)` to `tests/helpers.js` so error/namespace/script-only cases can be created inline without a fixture directory each.

### 12.2 New and rewritten suites

| Suite | Coverage |
|---|---|
| `tests/module-source.test.js` | section splitting; nested templates; self-closing components/slots; quote-aware attributes; `>`/`/` in attributes; comments; curly-brace protection; scan lines/casing. |
| `tests/tags.test.js` | common HTML/SVG/MathML tags; `template`/`script`/`style`/`slot`/`void`; hyphenated custom elements; `app` not static; suggestion behavior. |
| `tests/module-graph.test.js` | root entry validation; `.chjs` enforcement; import-relative resolution; nested deps; missing import; unknown tags with file/line and capitalized suggestion; no discovery of `unused.chjs`; non-`.chjs` imports not in graph; namespace imports; namespace collisions; same basename in different folders; module ids posix-relative; side-effect imports. |
| `tests/render.test.js` | exact result shape; fragment output; interpolation/slots/conditionals; scoped CSS; `hashMap` keys by module id; stable ids; script-only components render nothing; nested component runtime/chids; scoped styles not leaking; root `$runtime`; repeated render purity; concurrent renders with different `ctx`; cycle termination. |
| `tests/compiler-api.test.js` | exports; `compile()` returns in-memory result and writes nothing; `render()` writes nothing; no `emit`/`app`/`renderPage`. |
| `tests/config.test.js` | `normalizeConfig` defaults/overrides; no file I/O; removed keys have no effect. |
| `tests/pipeline.test.js` | Delete. Move any still-useful `fs.js` checks into a small `tests/fs.test.js` or cover indirectly. |
| `tests/parser-*.test.js`, `tests/runtime.test.js`, `tests/utils.test.js` | Keep, updating only namespace/colon cases if needed. |

### 12.3 Required regression tests

- Two `card.chjs` files under `a/` and `b/` imported as `A` and `B`: distinct module ids, distinct CSS ids, distinct canonical classes, both render correctly.
- Non-`.chjs` import:
  - `import { fmt } from "./format.js"` in a component with `$runtime` using `fmt`;
  - graph does not contain `format.js`;
  - emitted module chunk contains the exact import statement;
  - `.chjs` import lines are absent from emitted JS.
- Namespace:
  - `import * as Lib from "./lib/"` plus `<Lib:Card />` and `<Lib:Sub:Thing />`;
  - `<Lib />` errors;
  - prefix/local collision errors;
  - unknown namespace component errors with line.
- Self-closing:
  - `<Greeting />`, `<Greeting></Greeting>`, `<Card><span>slot</span></Card>`, `<slot />`;
  - `<my-widget />` stays as written;
  - `<A data-x="1 > 0" data-y="a/b" />` expands correctly.
- Script-only:
  - root script-only → `html === ""`;
  - nested script-only usage is removed from output and emits no chid.
- Purity:
  - `render` called twice produces identical `html`, `styles`, `runtime`, `hashMap`;
  - `Promise.all` with different `ctx` does not cross-contaminate;
  - no files created or modified during graph build/render.
- Stable ids:
  - `cssId === deterministicHash(module.id, 8)`;
  - runtime function id derives from `module.id`, not traversal order.
- Errors:
  - unknown tag line points at the correct source line after self-closing normalization;
  - missing `.chjs` file import reports `Cannot resolve import`.
- Cycle:
  - `a.chjs ↔ b.chjs` graph builds;
  - `render` terminates; document the current stop-recursion behavior.

## 13. Bench

Update `bench/fixtures.js`:

- basic fixture copies the new `tests/fixtures/basic` (root `app.chjs`);
- synthetic app writes `app.chjs` plus `lib/c0.chjs...`;
- root imports every component and uses `<C0 />...`;
- nested app writes `lib/d0.chjs...` with relative `.chjs` imports;
- template-size case puts filler directly in `app.chjs`;
- remove `chocola.config.json`, `src/index.html`, `.html` filenames, and `<app>`.

Update `bench/worker.js`:

- scenarios: `build` (`buildModuleGraph(root, { entry: "app.chjs" })`), `render`, optionally `compile`;
- remove `emit`, `config`, `discover`, `pageScan`, `buildReplicaGraph`, `pageScanReplica`, `contextFor`, pipeline imports, and asset/dom imports;
- context can report module count and root template bytes from the graph.

Update `bench/index.js`:

- reference table: `buildModuleGraph`, `render`, optional `compile`; remove emit/write-overhead rows;
- remove or replace `benchColdBuild` (no config/discovery/page scan to break down);
- scaling sweeps: component count, nesting depth, root template size;
- stable-id benchmark uses `.chjs` module ids such as `lib/c0.chjs`;
- runtime-size benchmark generates `.chjs` files, imports them from the root, renders, and reads `result.runtime`;
- keep CSV export behavior.

## 14. Documentation and changelog

Rewrite or update:

| File | Change |
|---|---|
| `README.md` | `.chjs` example; import components; compiler returns a fragment; host owns output. |
| `documentation/01-introduction/01-overview.md` | SFC is `.chjs`; import-based usage. |
| `documentation/01-introduction/02-getting-started.md` | No `src/index.html`/`<app>`; host supplies root `.chjs`; ChocolaKit remains the recommended host. |
| `documentation/02-components/01-fundamentals.md` | `.chjs`, optional `<template>`, `.html` removal. |
| `documentation/02-components/02-usage.md` | Import before use; local name is tag; relative resolution; self-closing and explicit pairs; slot projection. |
| `documentation/04-styling/01-scoped-styles.md` | Hash map keys are module ids; `.chjs` examples. |
| `documentation/04-styling/02-global-styles.md` | Global styles are host/document responsibilities; core returns scoped CSS only. |
| `documentation/05-runtime/02-components-api.md` | `.chjs` imports; generated classes are ESM; `new X().mount(...)` still works. |
| `documentation/06-architecture/01-compiler-flow.md` | Full rewrite: no config stage, no discovery, no page, `.chjs`, import graph, normalization, pure output, host duties, runtime descriptors. |
| `documentation/06-architecture/02-ssr-server.md` | Rewrite around host integration: `buildModuleGraph(rootDir, { entry })` + `render(graph, ctx)`; `files`/`copies` sections removed. |
| `documentation/07-reference/01-faq.md` | Replace `<app>`/`index.html` answers with root-component and host assembly answers. |
| `documentation/07-reference/02-testing-and-dev.md` | New API, new test/bench commands and descriptions. Append `AGENTS.md`, `CONTRIBUTING.md`, `ROADMAP.md` as needed (`ROADMAP.md` can mark "declarative imports" as completed under the RFC). |
| `CHANGELOG.md` | Add an unreleased breaking-change entry: `.chjs`, required imports, pure API, removed `emit`/`app`/config/discovery/assets, ESM runtime chunks, module-id hashes. |

Run a final grep for stale strings: `.html` component references, `<app>`, `src/index.html`, `srcDir`, `libDir`, `outDir`, `renderPage`, `emit`, `app.build`, `loadConfig`, `resolvePaths`, `getComponents`, `getSrcIndex`.

## 15. Migration and downstream ChocolaKit

Migration for users:

1. Rename components `.html` → `.chjs`.
2. Add `import X from "./X.chjs"` in every file that uses `<X>`.
3. Update imports in `$runtime` code to `.chjs` paths.
4. Replace `buildModuleGraph(rootDir)` / `compile(rootDir)` / `app.build(rootDir)` with `buildModuleGraph(rootDir, { entry })` / `compile(rootDir, { entry })`.
5. Stop relying on `emit`, `outDir`, static copying, config discovery, `.chocola/hashes.json`, and the `<app>` page.
6. Consume `{ html, styles, runtime, hashMap }` and write/serve output in the host.
7. Remove `srcDir` / `libDir` from configs.

ChocolaKit follow-up (separate repo, separate PR):

- currently imports `buildMultipageGraph`, `getComponents`, `renderPage`, `emitMultipage`;
- must own `chocola.config.json`, entry selection, multipage routing, document assembly (`<chocolakit:body>`), asset/JS bundling, output writing, and hash persistence;
- must call `buildModuleGraph(rootDir, { entry, config })` and `render(graph, ctx)`;
- must serve the new per-module ESM runtime chunks correctly.

Do not merge the core change without filing the Kit migration issue and noting the breaking API in the changelog.

## 16. Implementation sequence

### Phase 1 — parsing foundations (non-breaking)

- Add `compiler/module-source.js` and `compiler/tags.js`.
- Add `tests/module-source.test.js` and `tests/tags.test.js`.
- Keep the old compiler using the old path so `main` stays green.
- Exit criteria: self-closing expansion, raw splitting, tag scanning, and static-tag classification are proven in isolation.

### Phase 2 — graph and config

- Rewrite `compiler/module-graph.js` and `compiler/config.js`.
- Delete `compiler/pipeline.js`.
- Update `compiler/index.js` exports to the new graph API while temporarily keeping render/emit wiring if needed for a stacked PR.
- Add `tests/module-graph.test.js`.
- Exit criteria: import-only discovery, namespaces, unknown-tag errors, module ids, and pure config all pass.

### Phase 3 — pure render and runtime descriptors

- Rewrite `compiler/render.js`, `compiler/component-processor.js`, `compiler/dom-processor.js`, `compiler/runtime-generator.js`.
- Update `runtime/index.js` for colon-safe mounting.
- Remove `emit`/`app`/page/asset code.
- Rewrite `tests/compiler.test.js` into the new suites; update fixtures.
- Exit criteria: `render` returns the exact shape, writes nothing, preserves imports, and all render/runtime tests pass.

### Phase 4 — cleanup and teaching

- Rewrite docs, bench, changelog, `AGENTS.md`, `CONTRIBUTING.md`, `ROADMAP.md`.
- Delete `tests/pipeline.test.js` and any dead helpers.
- Run `npm test` and `npm run bench`.
- File the ChocolaKit migration issue.
- Exit criteria: no stale API references in the repo and acceptance criteria below are met.

## 17. Acceptance criteria

- [ ] `buildModuleGraph(rootDir, { entry, config })`, `render(graph, ctx)`, and `compile(rootDir, { entry, config, ctx })` are the only compiler entry points.
- [ ] `rootDir` must be absolute; `entry` is required; the root must be `.chjs`.
- [ ] Components are discovered only through `.chjs` imports; `getComponents`/`getSrcIndex` no longer exist.
- [ ] Non-`.chjs` files on disk are never discovered or included in `graph.modules`.
- [ ] An unimported non-static tag is a compile error with module id, line, and a capitalized near-miss suggestion when applicable.
- [ ] Imports resolve relative to the importing file.
- [ ] Namespace imports resolve `<Ns:Component>` and `<Ns:Subdir:Component>`; collisions and missing components error.
- [ ] Self-closing component and slot tags work; explicit pairs still work; hyphenated custom elements require explicit closes.
- [ ] `.chjs` with only `<script>` is valid and renders nothing.
- [ ] `render` performs no project I/O and writes nothing; it returns exactly `{ html, styles, runtime, hashMap }`.
- [ ] `html` is a fragment, not a document; `<app>` is no longer required.
- [ ] `hashMap` is keyed by root-relative module id; CSS and runtime hashes derive from module id.
- [ ] Two components with the same basename in different folders do not collide.
- [ ] Non-`.chjs` imports are preserved verbatim as ESM in generated client chunks; core does not bundle or rewrite them.
- [ ] `.chjs` imports are removed from emitted JS and replaced by generated class imports.
- [ ] `emit`, `app`, `renderPage`, `loadConfig`, `resolvePaths`, asset processing, and `.chocola/hashes.json` are removed from core.
- [ ] `npm test` passes.
- [ ] `npm run bench` runs with the new fixtures.
- [ ] Docs, changelog, `AGENTS.md`, and `CONTRIBUTING.md` contain no stale `.html`/`emit`/`renderPage` guidance.

## 18. Risks and open items

| Risk / question | Plan |
|---|---|
| Tag casing is lost in `linkedom`. | Scan the raw template for errors/suggestions; use lowercased tags only for resolution. |
| Self-closing normalization can corrupt attributes containing `>` or `/`. | Quote-aware scanner, skip comments/script/style, protect curly-brace regions, dedicated tests. |
| `parseHTML` currently mangles self-closing tags before normalization. | Split raw sections before any HTML parse; normalize before `parseHTML`. |
| Namespace directories can be large and eagerly walked. | Accept for v1 per RFC `moduleIds`; document and add a later lazy/index option if needed. |
| Namespace prefix/local collision behavior. | Graph-build error; test both default and named locals. |
| Same-basename components and class names. | Hash all ids/classes from `module.id`; alias imports per local. |
| Non-`.chjs` import collisions in one chunk. | One ESM chunk per module; module-scoped imports. |
| Circular `.chjs` imports with CSR classes. | Graph allows cycles; render stops recursion by module id. ESM class cycles may still throw at runtime; document and add a graph/render cycle test. |
| Runtime chunks become ESM. | Required by RFC resolved question #5; document that hosts load them as modules and that chunk names are id-based, not content-hashed. |
| Root-only static apps still get a base runtime chunk. | Preserve current behavior; hosts may ignore `runtime` when empty of calls. Revisit if it becomes noise. |
| `renderPage` removal is breaking. | Add a clear changelog entry and migration guide; optionally add a one-release deprecation alias if maintainers request it. |
| `findElementLine` after normalization. | Normalization only replaces `/ >` with `></Tag>` on the same line; add line-number regression tests. |
| Windows path ids. | Always normalize module ids with `path.relative(...).split(path.sep).join("/")`; add a Windows-safe test assertion. |
| Unknown tags in text interpolations (`{a < b}`). | Scan a brace-protected copy of the template. |
| Script-only imports and no template. | Render nothing; do not emit chids/runtime calls; still keep the module in the graph. |
| `treeShakeRuntime` semantics. | Only filters declarations injected into a module's own `$runtime`; no cross-module reachability. |
| ChocolaKit breakage. | Separate follow-up issue/PR; do not ship core without migration notes. |

## 19. Suggested PR split

1. **Parsing foundations**: `module-source.js`, `tags.js`, tests; no behavior change.
2. **Import graph + pure config**: `module-graph.js`, `config.js`, delete `pipeline.js`, module-graph tests.
3. **Pure render + runtime**: `render.js`, `component-processor.js`, `dom-processor.js`, `runtime-generator.js`, `runtime/index.js`, fixture/test rewrite.
4. **Docs, bench, changelog, Kit issue**: documentation, bench, `CHANGELOG.md`, `AGENTS.md`, `CONTRIBUTING.md`, `ROADMAP.md`, downstream migration issue.

PRs 1 and 2 can be stacked behind PR 3 if the intermediate state would leave `main` half-broken; the important constraint is that the final PR runs the full suite and bench before merge.
