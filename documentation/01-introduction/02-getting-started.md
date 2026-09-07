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
├── chocola.config.json
├── chocola.server.js
└── chocola.js
```

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

## 4. Create `chocola.js`

```js
// file: chocola.js
import { app } from "chocola/compiler";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.build(__dirname);
```

## 5. Create `chocola.server.js` — Dev server

```js
// file: chocola.server.js
import { dev } from "chocola/dev";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dev.server(__dirname);
```

For production SSR, create a separate entry (e.g. `server.js`):

```js
// file: server.js
import { serve } from "chocola/server";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// honors chocola.config.json -> server.port / hostname / middleware
serve(__dirname);

// Or bare handler: import { createHandler } from "chocola/server";
// const handler = await createHandler(__dirname);
// http.createServer(handler).listen(8080);
```

## 6. Initialize your index page

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

Now you're all set! Run `node chocola.server.js` for local dev with hot-reload, `node chocola.js` for a static build, or `node server.js` for SSR.
