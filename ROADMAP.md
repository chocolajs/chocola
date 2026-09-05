# Chocola Framework Roadmap

Chocola ships one version at a time. Nothing on this list starts until the layer beneath it is solid.

## V1 (1.0.0 - 1.6.0)

Proof of concept for Chocola. It implemented the foundations of its core philosophy.

## V2 (in progress)

Focus on production-readiness; hardening V1, giving components a proper file format and adding dynamic rendering.
Introduces the `$` prefix.

- [x] SFCs
- [x] Imperative components API
- [x] New `$runtime` function replacing `RUNTIME`
- [x] Scripts bundling
- [x] Scoped functions
- [x] `bind:` DOM manipulation
- [x] Deterministic hashing
- [x] Declarative components imports
- [ ] (**current milestone**) Limited SSR (designed for using plugins and middlewere for extensible production deployment)
- [ ] HMR dev server
- [ ] ESM modules and dependencies bundling
- [ ] `for:each` and `switch/case` directives
- [ ] `<as:html></as:html>` blocks for raw HTML injection
- [ ] `style:<style>="{foo}"`, `class:<class>="{foo}"` and `<attribute>?="{foo}"` directives
- [ ] `$debug(...data)` method to add dev logs that will be removed in final build and production mode
- [ ] `on:*` event shorthands
- [ ] TypeScript support

## Future releases

The following changes are planned to be implemented in future releases once the V2 foundations are delivered:

- [ ] SPA support
- [ ] Reactivity with `${foo}` bindings
- [ ] Global state and lifecycle hooks
- [ ] `$bake` and `$cast` directives for fine-grained statefulness management
- [ ] Global portable CLI

---

Have thoughts on sequencing or want to propose something for a later version? File an [issue](https://github.com/chocolajs/chocola/issues/new/choose), open a [PR](https://github.com/chocolajs/chocola/blob/main/.github/PULL_REQUEST_TEMPLATE.md) or start a [RFC](https://github.com/chocolajs/rfcs).
