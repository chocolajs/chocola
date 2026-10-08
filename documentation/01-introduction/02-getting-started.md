---
title: Getting started
description: Set up a Chocola project from scratch
---

It's recommended to use [ChocolaKit](https://github.com/chocolajs/kit) to build your web apps, or consuming Chocola with Vite for bigger projects.

To use ChocolaKit, create your project:

```
my-app/
└── src/
    ├── lib/          # your components
    ├── static/       # your static assets
    ├── index.html    # your entry point
    └── ...           # other files (scripts, styles, favicons, etc.)
```

Then run:

```
npm init
npm i @chocolajs/kit
chjs dev
```

This will setup your Node project, install ChocolaKit and start the dev server.

## Using ChocolaKit globally

By installing ChocolaKit globally you will be able test, serve and build your Chocola apps anywhere without having a `package.json` or a `node_modules/`.

First, install ChocolaKit globally with

```
npm i -g @chocolajs/kit
```

Then, just open any Chocola project an run `chjs dev` to start the dev server. If the project includes a specified version of ChocolaKit, it will fallback to it instead of the globally installed version.