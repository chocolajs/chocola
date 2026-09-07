---
title: Project structure
description: The anatomy of a Chocola project
---

Here is the typical layout of a Chocola project:

```
my-app/
├── src/
│   ├── lib/
│   │   ├── Button.html
│   │   ├── Card.html
│   │   └── ...
│   ├── static/
│   │   ├── images/
│   │   ├── fonts/
│   │   └── ...
│   └── index.html
├── .chocola/
│   └── hashes.json
├── chocola.config.json
├── chocola.server.js
├── chocola.js
├── package.json
└── .gitignore
```

## `src/` — Source directory

The main folder where you build your app.

### `src/index.html`

The entry point of your app. All content goes inside an `<app>` element:

```html
<html>
  <head>
    <title>My App</title>
  </head>
  <body>
    <app>
      <Button label="Hello" />
    </app>
  </body>
</html>
```

Chocola compiles this page together with your components and outputs the final build.

### `src/lib/` — Components

Place your Chocola components here. Each component is a single `.html` file with a `<template>`, and optionally `<script>` and `<style>` tags:

```
src/lib/
├── Button.html
├── Card.html
├── Navbar.html
└── ...
```

See [Component fundamentals](../02-components/01-fundamentals.md) for details.

### `src/static/` — Static assets

Files placed here are copied unchanged to the output directory. Use it for images, fonts, PDFs, or any other static files your app needs.

## `chocola.config.json` — Configuration

Defines the paths and dev server settings:

```json
{
  "bundle": {
    "srcDir": "src",
    "outDir": "dist",
    "libDir": "lib",
    "emptyOutDir": true
  },
  "dev": {
    "hostname": "localhost",
    "port": 3000
  },
  "server": {
    "port": 8080,
    "hostname": "localhost",
    "middleware": null
  }
}
```

| Key | Default | Description |
|---|---|---|
| `srcDir` | `"src"` | Source directory |
| `outDir` | `"dist"` | Build output directory |
| `libDir` | `"lib"` | Components directory (inside `srcDir`) |
| `emptyOutDir` | `true` | Clean output before each build |
| `dev.hostname` | `"localhost"` | Dev server hostname |
| `dev.port` | `3000` | Dev server port |
| `server.hostname` | `"localhost"` | SSR server hostname (`server.host` also accepted) |
| `server.port` | `8080` | SSR server port |
| `server.middleware` | `null` | Path to ESM middleware file (relative to project root) |

## `chocola.js` — Build script

Runs a production build:

```js
import { app } from "chocola/compiler";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.build(__dirname);
```

## `chocola.server.js` — Dev server

Starts the development server with hot reload (`chocola/dev`):

```js
import { dev } from "chocola/dev";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dev.server(__dirname);
```

## `server.js` — SSR server (production)

For deployable server-side rendering (`chocola/server`):

```js
import { serve } from "chocola/server";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

serve(__dirname);
// Or: import { createHandler } from "chocola/server";
// const handler = await createHandler(__dirname);
// http.createServer(handler).listen(8080);
```

Per-request `ctx` (query + middleware) is passed to `renderPage(graph, ctx)`; static/virtual assets are served with `ETag`, `Last-Modified`, and `gzip`.

## Other files

### `.chocola/hashes.json`

Auto-generated reference file that maps component filenames to their deterministic CSS scope hashes (8-letter `a-z` from `deterministicHash(componentName)`, stable across builds):

```json
{
  "button.html": "xqkfybnh",
  "card.html": "mptzrwxj"
}
```

This file is written after every build. Use it to identify which component rendered a given element when inspecting the output in the browser. It is a build artifact and should not be committed to version control. Asset filenames are also deterministic (`sc-<hash>.css`, `css-<hash>.css`, `js-<hash>.js`, `run-<hash>.js` — hash of content).

### `package.json`

Your Node.js project manifest. Chocola is listed here as a dependency.

### `.gitignore`

Should include at least:

```
node_modules/
dist/
.chocola/
```
