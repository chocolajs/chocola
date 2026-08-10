# Chocola Framework Roadmap

Chocola ships one version at a time. Nothing on this list starts until the layer beneath it is solid.

## V1 — Foundations
**Status: Available**

The core compiler and the minimum needed to build a real page with it.

- Single page SSG
- Compile-time HTML source file rendering
- Static assets packaging
- Relative asset routes resolving
- Modular components (JS files that return an object with a `RUNTIME` function, and an imported HTML template and CSS file)
- `RUNTIME` function receives `self` (component root element) and `ctx` (passed properties) parameters
- Components props and control flow as HTML attributes
- `{foo}` props and contextful bindings
- `<void>` transparent wrapper
- `if/elif/else` HTML blocks for conditional display
- `del:if/elif/else` HTML blocks for conditional rendering
- CSS scoping
- CSS imports
- `:root` CSS selector as placeholder for the component root element
- Hot-reload dev server (no HMR)
- Detailed logging

## V2 — Consolidation
**Status: In progress**

Hardening V1, giving components a proper file format and adding dynamic rendering.
Introducing the `$` prefix.

### Available now
- New SFC (Single-File Components) system with tags: `<head>`, `<script>`, `<template>`, `<style>`
- Imperative components API
- New `$runtime` function replacing `RUNTIME`.
- Scripts bundling
- Scoped functions
- `bind:` attribute for manipulating DOM elements.
- Deterministic CSS scope hashes with a reference map written to `.chocola/hashes.json`.
- Changed `del:if` directive to `mount:if`
- Fully scoped components `script`

### Breaking changes
- CSR SPA router
- Declarative components imports

### New features
- HMR dev server
- ESM modules and dependencies bundling
- `for:each` and `switch/case` logic blocks
- `<as:html></as:html>` blocks for raw HTML injection
- `<const value="{foo}">` tag to define a local constant
- `style:<style>="{foo}"`, `class:<class>="{foo}"` and `<attribute>?="{foo}"` directive HTML attribute
- `$debug(...data)` method to add dev logs that will be removed in final build
- `on:*` event shorthands
- Typed properties

## V3 — Reactivity
**Status: Planned**

The state layer: `ctx`, typed properties, and everything that depends on them staying live in the browser.

- Reactivity engine
- Live `${foo}` bindings
- Global state and lifecycle hooks
- `$bake` and `$cast` attributes and functions to define components statefulness

## V4 — Shipping
**Status: Planned**

Taking Chocola past static output.

- Server-side SPA and more features to plan

---

Have thoughts on sequencing or want to propose something for a later version? Open an issue.
