## The core insight

Chocola already contains an isomorphic renderer — it just isn't used as one. `processComponentElement` (`compiler/component-processor.js`) together with the parser helpers (`compileExpr`, `interpolateNode`, `applyConditionalToElement`) renders a component to a DOM fragment using linkedom, driven by a `ctx` object and `with(ctx)` expressions. The browser runtime (`ChocolaComponent.#init`) performs the *same* logic against a real `document`. The only structural gap is the lack of a separation between *"render a module"* and *"write files to disk"*.

Making the module render the unit of work lets build, HMR and SSR share one code path.

## Components and pages become modules

Each source file is compiled to a `ChocolaModule`:

| Field | Description |
|---|---|
| `id` | Canonical path relative to `src` (stable marker + output name) |
| `render(ctx)` | linkedom render — returns the DOM fragment |
| `csrClassSource` | The `ChocolaComponent` subclass (already produced today) |
| `styles`, `hash` | Scoped css + deterministic scope class |
| `deps` | Child module ids (tag usage + `import X from "..."`) |
| `runtimeChunk` | The `$runtime()` invocation source |

Modules live in a mutable `ModuleGraph`:

- Nodes: the `index.html` page, every `src/lib/*.html` component, `<link>`/asset modules.
- Edges: page → components → child components.
- Compiled modules are cached by `id` with mtime-based invalidation.

## Splitting the compiler

Today `compile()` (`compiler/index.js`) interleaves rendering with file writes (via `dom-processor.js` and `runtime-generator.js`). It is split into three layers:

1. `buildModuleGraph(rootDir)` — discovery + parsing, no writes. Reuses `getComponents`/`getSrcIndex` from `compiler/pipeline.js`.
2. `renderPage(graph, pageModule, ctx)` — pure walk of the graph producing `{ html, styles, scripts }`.
3. `emit(graph, outDir)` — the existing writers (HTML, CSS, JS, runtime chunks, static assets).

`compile()` becomes `emit(buildModuleGraph())` — identical behavior, but rendering is now a pure function that any consumer can call.

## Three entry points, one pipeline

| Entry | Mode | Purpose |
|---|---|---|
| `chocola/compiler` | Static build | `buildModuleGraph()` + `emit()` → full static site (unchanged) |
| `chocola/server` | Directly deployable SSR | Own `http` server rendering pages per request |
| `chocola/ssr` | Render functions only | Hand the same rendering to external infrastructure |
| `chocola/dev` | HMR dev server | Live graph + file watcher + websocket patch transport |

## `chocola/ssr` — render functions for external infrastructure

No server, no bundler. Callable render functions to host inside whatever HTTP layer already exists:

```js
import { createServerRenderer } from "chocola/ssr"

const render = createServerRenderer({ rootDir, routes: [{ path: "/", page: "index" }] })

// Express / Fastify / serverless handler:
app.get("/", async (req, res) => {
  res.send(await render("index", { user: req.user }))
})
```

- Builds the module graph once, caches compiled modules by `id`, re-renders only the requested tree per request. No rebuild, no writes.
- Props are request-time `ctx`, merged exactly like `ChocolaComponent.#init` merges `{ ...defaultProps, ...ctx }` — rendering is isomorphic by construction.
- `$runtime` remains a client-side hydration step: the SSR page ships the existing CSR classes, and hydration runs after load. No hydration ceremony.
- `renderComponent(name, ctx)` is also exposed, so external services can produce standalone component HTML (SSR micro-frontends) without rendering a whole page.

## `chocola/server` — directly deployable

A thin production server on the same `http` stack the dev server already uses, pointed at the render pipeline. Simple apps deploy with a config file and nothing else.

### Built-in capabilities

- Serves routes from a generated route table (`path → page module`), SSR-rendered per request.
- Static assets with mime types, `ETag`/`Last-Modified`, `gzip`.
- Per-request props merged server-side; `$runtime` hydrates via the existing CSR classes.
- One process, one config file.

### Middleware hook

One minimal hook lets single-server apps augment requests without abandoning direct deployability:

```js
// chocola.config.json
{
  "bundle": { "srcDir": "src", "outDir": "dist" },
  "dev": { "port": 3000 },
  "server": {
    "port": 8080,
    "middleware": "./server-middleware.js"
  }
}
```

```js
// server-middleware.js
export default [
  async ({ params, query, cookies }) => {
    const user = await auth(sessionToken(cookies));
    return { user, title: "..." }; // merged into ctx → available in templates
  },
  (req, res) => { /* short-circuit: send 401 before rendering */ },
];
```

Middleware runs per request before render and either mutates `ctx` (returned object merged into per-request props) or short-circuits the response. The server keeps owning transport, so most apps never mount their own HTTP layer. `createServer({ rootDir })` additionally returns a bare `http` request handler for anyone who wants `http.createServer(handler).listen()` — middleware as a plain request-wrapper, today, with no framework shipped by Chocola.

### Deliberate limitations

These scope cuts are what keeps the server lightweight — and they are the boundary past which you move to `chocola/ssr` + your own middleware stack:

| Not provided | Consequence |
|---|---|
| No middleware pipeline / lifecycle hooks | No auth/session gates or API routes in `chocola/server` |
| No dynamic routes / params / wildcards | Only routes from the generated table; no `/user/:id` |
| No request body parsing | Mutations live client-side |
| No streaming / SSE / partial HTML | Ceilings on very long responses |
| No server-side cookies / user state | Everything stateful hydrates client-side |
| No hard header control (beyond content-type + rendering) | Limited CDN/security-header config |
| Single-process, no clustering, no exported cache | You own scale-out |

The promise: simple apps get zero infra; complex apps keep Chocola's pipeline but own the HTTP layer.

## `chocola/dev` — HMR

Replaces today's polling full-reload (see `dev/index.js`) with in-place module patching.

### Transport

- WebSocket endpoint (`/__chocola`) with an injected client (`runtime/hmr-client.js`), replacing the current `hotReloadScript` injection.
- Kept as fallback: the existing polling API.

### Flow

- The module graph stays alive in the dev process after the initial build.
- The file watcher debounces changes, recompiles *only* the changed module, and patches its node plus reverse-dependency dependents in the graph.
- Patch payloads:
  - `css` → swap the scoped `<link>` href. No reload.
  - `component` → re-render the changed subtree, send `{ module, html, hash }`; the client locates nodes by a `data-chol="<moduleId>"` marker (added by the compiler in dev mode), replaces only those subtrees, then re-runs the CSR class / `$runtime` on them.
  - `index.html` / config → full-reload event.
- Compile errors push to the client as an overlay without reloading, preserving dev state (scroll position, open state).

### Unification over the SSR renderer

An HMR component patch is literally `renderComponent(module, ctx)` on the server plus subtree replacement on the client. HMR and SSR share the render path — different transports, same function. Applying patches to server-authored DOM (SSR output) instead of a static page is a better HMR story: the patched tree is consistent with what the server would render.

## Supporting changes

- **Stable runtime ids**: today's per-build letter prefixes (`ar()`, `br()` in `component-processor.js`) depend on traversal order and break HMR mapping and reproducible SSR. Replaced with per-module hashed ids (`r_<8ch>`).
- **Module-scoped caches**: `compileExpr` caches by expression string globally (`parser/utils.js`) — valid for identical strings, but module artifacts (child mappings, runtime chunks) come from the graph node so recompiling a module replaces just that node and its dependents.
- **Deterministic CSS hashes** are already filename-based and stable across edits — exactly what CSS HMR needs. Kept as-is.

## Sequencing

1. Compiler refactor → `buildModuleGraph()` + `emit()` + stable runtime ids. No behavior change.
2. `chocola/server` — deployable SSR: route table, ctx middleware, static/gzip/ETag.
3. `chocola/ssr` — `createServerRenderer` + `renderComponent` (the escape hatch; also `chocola/server`'s own implementation).
4. `chocola/dev` — HMR: WS transport, `data-chol` markers, CSS patch first, then component subtree patch, then dependents invalidation.
5. Hydration parity across all three entry points.