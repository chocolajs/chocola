---
title: Getting started
description: Set up a Chocola project from scratch
---

It's recommended to use [ChocolaKit](https://github.com/chocolajs/kit) to build your web apps, or consume Chocola directly with Vite or another host for bigger projects.

To use ChocolaKit, create your project:

```
my-app/
├── app.chjs          # root component
├── lib/              # optional components
│   └── Card.chjs
└── ...               # other files your host serves or bundles
```

Then run:

```
npm init
npm i @chocolajs/kit
chjs dev
```

This will set up your Node project, install ChocolaKit, and start the dev server.

## Alternatives to ChocolaKit

Chocola is transport-agnostic. Any host can build a graph and render it:

```js
import { buildModuleGraph, render } from "chocola/compiler";

const graph = await buildModuleGraph(process.cwd(), { entry: "app.chjs" });
const { html, styles, runtime, hashMap } = await render(graph, {
    name: "Ada",
});
```

`rootDir` must be absolute and `entry` must point to a `.chjs` file. There is no implicit `index.chjs` lookup.

The result contains the rendered fragment, scoped CSS, ESM runtime descriptors, and the module-to-CSS hash map. Your host decides where to write those files, how to serve them, and what document shell to use.

`compile(rootDir, { entry, config, ctx })` is available as a convenience when you want the graph and render in one call.

