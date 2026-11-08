---
title: FAQ
description: Frequently asked questions about Chocola
---

## Getting Started

### What exactly is Chocola?

Chocola is a small library for building apps out of reusable single-file components — little self-contained pieces of HTML, CSS, and JavaScript that you snap together. Components are `.chjs` files.

When you build, Chocola compiles them into a plain HTML fragment with scoped CSS and optional ESM runtime. No framework runtime ships to the browser.

### How do I get a project up and running?

The recommended way is ChocolaKit (`@chocolajs/kit`), which supplies the dev server, CLI, routing, and document assembly. For a custom host, use the core API:

```js
import { buildModuleGraph, render } from "chocola/compiler";

const graph = await buildModuleGraph(process.cwd(), { entry: "app.chjs" });
const { html, styles, runtime, hashMap } = await render(graph, { name: "Ada" });
```

`rootDir` must be absolute and `entry` must point to a `.chjs` file. There is no `src/index.html` and no implicit `index.chjs` lookup.

## Components

### What does a component look like?

A component is a single `.chjs` file with up to three sections, all optional: `<template>`, `<script>`, and `<style>`.

```html
<!-- file: Card.chjs -->
<script>
    export let title = "Card";
</script>

<template>
    <h1>{title}</h1>
    <slot></slot>
</template>

<style>
    h1 { color: chocolate; }
</style>
```

A file with only `<script>` is valid and renders nothing.

### How do I use a component?

Import it in the `<script>` of the file that renders it, then use the local name as the tag:

```html
<script>
    import UserCard from "./UserCard.chjs";
</script>

<template>
    <UserCard title="Profile" />
</template>
```

Tags are resolved through imports. An unimported non-static tag is a compile error with the module id, line, and a suggestion when a close name exists.

### Can a component render content passed into it?

Yes — put a `<slot>` element in your component's template. Whatever you write between the component's opening and closing tags in the parent gets rendered in that spot.

```html
<!-- component template -->
<div class="card">
  <slot></slot>
</div>

<!-- usage -->
<Card>
  <p>Hello from the parent</p>
</Card>
```

### Can I import a whole directory of components?

Yes:

```html
<script>
    import * as Lib from "./lib/";
</script>

<template>
    <Lib:Card />
    <Lib:Sub:Thing />
</template>
```

Namespace components resolve relative to the directory import.

## Props & Data

### How do I send data into a component?

Add attributes to the component tag — those become props. Strings go in plain, everything else (numbers, booleans, variables) gets wrapped in curly braces so Chocola evaluates them properly:

```html
<Counter label="Clicks" start={5} active={true}></Counter>
```

Inside the component's `<script>` and `$runtime`, those values are in scope by name (e.g. `label`, `start`); they are merged from defaults and the caller-supplied `ctx`.

### How do state and reactivity work?

Reactivity and state will be added in the future. As of now, manually update contents via a component's `$runtime` function and global scripts.

## Templates & Logic

### How do I show or hide something based on a condition?

Two options. The `if` attribute hides the element visually (keeps it in the DOM with `display: none`). The `mount:if` attribute removes it from the DOM entirely. Use `mount:if` when the element shouldn't be there, and `if` when you might want to toggle it back quickly.

```html
<div if={isVisible}>Hidden but still in the DOM</div>
<div mount:if={shouldRemove}>Gone completely</div>
```

### Can I use JavaScript expressions directly in HTML?

Yes:

```html
<h1>{title ?? "Untitled"}</h1>
<div class="box {isActive ? 'active' : ''}"></div>
<p if={temperature > 30}>It's hot outside!</p>
```

## Styling

### Will component CSS bleed into the rest of the page?

No. CSS inside `<style>` is automatically scoped. Chocola adds a per-module scope attribute to the component's elements under the hood.

A `button { color: red }` rule in one component won't affect buttons anywhere else.

### What if I want styles that apply to the whole site?

Global styles are the host's responsibility. Include them in the document shell your host assembles. Chocola core returns only the scoped component CSS in `styles`.

## Runtime

### When does my component's script run?

Once, right after the component has been rendered into the DOM. It's the right place to attach event listeners, kick off fetches, set up timers, or anything else that needs the HTML to be there already.

### What is `self`?

`self` is the root DOM node of your component instance, injected into `$runtime`. Always use `self.querySelector()` instead of `document.querySelector()` to avoid bugs when multiple instances of the same component exist.

### How does client-side code load?

`render()` returns `runtime` descriptors instead of a single bundled script. Each component module is its own ESM chunk. The host serves those chunks, and the returned chunks import `ChocolaComponent` and child classes by filename. Load them as modules or let your bundler resolve them.
