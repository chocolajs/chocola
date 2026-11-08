# Chocola Coding Agent Guide

This guide is for AI coding agents working in Chocola.

**Important:** Read and follow [`CONTRIBUTING.md`](./CONTRIBUTING.md) as well — it contains essential information about testing, code structure, and contribution guidelines that applies here.

When submitting a PR, you **MUST** read [`PULL_REQUEST_TEMPLATE.md`](./.github/PULL_REQUEST_TEMPLATE.md) and fill it out correctly. **DO NOT** submit a PR without running the full test suite.

## Quick Reference

If asked to do a performance investigation, use the `performance-investigation` skill.

## Project Structure

This repo is the **core library only** (`chocola`). A metaframework (dev server, SSR server, CLI) lives in its own repo as ChocolaKit (`@chocolajs/kit`).

- **Core**: `compiler/`, `parser/`, `runtime/`, `utils.js` — consumable by any stack (Vite, Next.js, ChocolaKit, etc.)
- **Components**: `.chjs` single-file components. Only imported modules enter the graph; there is no filesystem discovery, page, config, or asset stage in core.
- **Public API**: `buildModuleGraph(rootDir, { entry, config })`, `render(graph, ctx)`, and `compile(rootDir, { entry, config, ctx })` from `chocola/compiler`; `ChocolaComponent` from `chocola/runtime`; parser helpers from `chocola/parser`.
- **Pure output**: `render` returns exactly `{ html, styles, runtime, hashMap }`, reads no project files, and writes nothing. Hosts own document assembly and output.
- **Tests**: `tests/*.test.js` — run with `pnpm test`
- **Bench**: `bench/` — run with `pnpm run bench`

## Changelog Style

`CHANGELOG.md` tracks only changes to the delivered `chocola` package, meaning the published library code. It is user-centered: describe features, behavior changes, and migration steps in plain language — not the source code.

- Do not include repository-only work such as documentation, `AGENTS.md`, `CONTRIBUTING.md`, tests, benchmarks, CI, or tooling. If it does not ship in the package, it does not belong in the changelog.
- Lead with what changed for users and why it matters.
- Do not list internal function names, file-by-file edits, or implementation details.
- Group entries under headings such as `Added`, `Changed`, `Fixed`, `Breaking changes`, or `Migration` when useful.
- Breaking changes must say what changed, who is affected, and how to migrate.
- Notable internal work that does not change the public API still belongs in a short, non-technical summary under `Under the hood`, for example:
  - minor optimization;
  - heavy code cleanup;
  - important refactor or core compiler change.
- Do not present dead-code removal or routine refactors as user-facing features unless they materially affect users.
