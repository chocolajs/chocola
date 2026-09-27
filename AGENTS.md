# Chocola Coding Agent Guide

This guide is for AI coding agents working in Chocola.

**Important:** Read and follow [`CONTRIBUTING.md`](./CONTRIBUTING.md) as well - it contains essential information about testing, code structure, and contribution guidelines that applies here.

When submitting a PR, you **MUST** read [`PULL_REQUEST_TEMPLATE.md`](./.github/PULL_REQUEST_TEMPLATE.md) and fill it out correctly. **DO NOT** submit a PR without running the full test suite.

## Quick Reference

If asked to do a performance investigation, use the `performance-investigation` skill.

## Project Structure

- **Core library**: `compiler/`, `parser/`, `runtime/`, `utils.js` — consumable by any stack (Vite, Next.js, etc.)
- **Metaframework**: `metaframework/dev/`, `metaframework/server/`, `metaframework/bin/`, `metaframework/utils.js` — dev server, CLI, SSR server
- **Tests**: `tests/*.test.js` — run with `npm test`
- **Bench**: `bench/` — run with `npm run bench`
- **CLI**: `node metaframework/bin/chocola.js --help`