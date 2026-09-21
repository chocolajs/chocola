---
title: CLI reference
description: Chocola command-line interface reference
---

## Installation

Chocola ships a globally-installable CLI via `package.json#bin`:

```sh
npm install -g chocola
# or use npx / pnpx / bunx
npx chocola build
```

Both `chocola` and `chjs` are available as commands.

## Commands

```
Usage: chocola <command> [root] [options]

Commands:
  build   Build for production (static)
  dev     Start dev server with HMR
  serve   Start SSR production server

Options (common):
  -c, --config <path>   Path to config file (default: <root>/chocola.config.json, optional)
  -h, --help            Show help
  -v, --version         Show version
  --plain, NO_COLOR=1   Disable color output
```

### `chocola build [root]`

Builds for production. Creates `dist/index.html`.

```sh
chocola build                        # build with defaults
chocola build ./my-app               # build specific project
chocola build --outDir ./tmp/build   # override output directory
chocola build --srcDir ./src         # override source directory
chocola build --libDir ./components  # override components directory
chocola build --no-emptyOutDir       # do not clean outDir before build
chocola build --config ./alt.json    # use explicit config file
```

### `chocola dev [root]`

Starts a dev server with HMR. Default port: 3000.

```sh
chocola dev                          # dev server at http://localhost:3000
chocola dev --port 5173              # override port
chocola dev --host 0.0.0.0           # bind to all interfaces
chocola dev --open                   # open browser after start
chocola dev --config ./chocola.dev.json  # use explicit config
```

### `chocola serve [root]`

Starts an SSR production server. Default port: 8080. Honors `PORT` env for container deployment.

```sh
chocola serve                        # server at http://localhost:8080
chocola serve --port $PORT           # honor PORT env (flag > env > config > default)
chocola serve --host 0.0.0.0         # bind to all interfaces (default when PORT is set)
chocola serve --middleware ./mw.js   # attach ESM middleware
chocola serve --config ./chocola.prod.json
```

## Config file (`chocola.config.json`)

Fully optional. If absent, defaults are used silently (`srcDir: "src"`, `outDir: "dist"`, `libDir: "lib"`, `dev.port: 3000`, `server.port: 8080`).

```json
{
  "bundle": { "outDir": "build", "emptyOutDir": false },
  "dev": { "port": 5173 },
  "server": { "middleware": "./middleware.js" }
}
```

**Precedence:** CLI flags > `chocola.config.json` > built-in defaults.

When `--config <path>` is explicit and the file is missing, `ENOENT` is thrown so typos surface immediately.

## Container deployment

`chocola serve` honors `PORT` env:

```sh
PORT=8080 chocola serve --host 0.0.0.0
```

When `PORT` is set and no explicit host flag/config exists, hostname defaults to `0.0.0.0` for container binding.

## Local delegation (Vite-style)

When invoked globally, the CLI resolves `chocola/package.json` from the project root and uses the local installation if found. Falls back to the global CLI's bundled modules. This ensures `npm i -g chocola@2.1` + project-local `chocola@2.0-next.11` runs the project's pinned version.

## Migration from init scripts

If your project has `chocola.js`, `chocola.server.js`, or `server.js`, they are now legacy. Remove them and use the CLI:

```sh
rm chocola.js chocola.server.js server.js
chocola build   # was: node chocola.js
chocola dev     # was: node chocola.server.js
chocola serve   # was: node server.js
```

Programmatic APIs (`app.build`, `dev.server`, `serve`, `createHandler`) remain available for custom Node tooling.
