---
title: Getting started
description: Set up a Chocola project from scratch
---

## 1. Set up your directory

```
my-app/
├── src/
│   ├── lib/
│   ├── static/
│   └── index.html
└── chocola.config.json (optional)
└── package.json
```

> **Note:** `chocola.js`, `chocola.server.js`, and `server.js` are **legacy**. Replaced by `chocola build`, `chocola dev`, `chocola serve` CLI. See [Project structure — Migration](03-project-structure.md#migration) below.

## 2. Install Chocola

```sh
npm install chocola
```

## 3. Create a `chocola.config.json` config file

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
    "middleware": "./middleware.js"
  }
}
```

## 4. Install Chocola

```sh
npm install chocola
```

## 5. Initialize your index page

Write something in your `src/index.html` index page. Remember to include an `<app>` element — that's where Chocola applies its magic.

```html
<!-- file: src/index.html -->
<html>
  <head>
    <title>My Chocola App</title>
  </head>
  <body>
    <app>
      Hello World!
    </app>
  </body>
</html>
```

## 6. Run Chocola

No init scripts needed — Chocola ships a CLI that handles everything:

```sh
# Start dev server with HMR on port 3000
npx chocola dev

# Build for production
npx chocola build

# Start SSR production server
npx chocola serve

# Override defaults with flags
npx chocola dev --port 5173 --host 0.0.0.0
npx chocola build --outDir ./tmp/build --srcDir ./src
npx chocola serve --port $PORT --host 0.0.0.0
```

With a `chocola.config.json` (optional), CLI flags take precedence:

```json
{
  "bundle": { "outDir": "build" },
  "dev": { "port": 5173 },
  "server": { "middleware": "./middleware.js" }
}
```

```sh
chocola dev --port 4000   # flag wins over config (4000), config wins over default (5173 vs 3000)
```

For advanced use, programmatic APIs remain available: `app.build(__dirname)`, `dev.server(__dirname)`, `serve(__dirname)`, `createHandler(__dirname)`.
