---
title: FAQ
description: Frequently asked questions about Chocola
---

## Getting Started

### What exactly is Chocola?

Chocola is a small web framework that lets you build apps out of reusable components — little self-contained pieces of HTML, CSS, and JavaScript that you snap together. When you're ready to ship, Chocola compiles everything into plain vanilla JavaScript. No framework baggage, no runtime to download, just clean code in the browser.

### How do I get a project up and running?

Install Chocola with `npm install chocola`, then create `chocola.config.json` (tells Chocola where your files live), `chocola.js` (runs the build), and `chocola.server.js` (dev server with `chocola/dev`). Your HTML entry point lives at `src/index.html`.

Once that's in place, `node chocola.server.js` gets you a live-reloading browser preview for development. For production SSR, use `chocola/server` (`serve()` or `createHandler()`).

### Why does my HTML need an `<app>` tag?

The `<app>` element is the landing zone where Chocola drops all your compiled components. Think of it as the stage — Chocola won't know where to put anything without it. Everything outside `<app>` (like your `<head>` or a nav bar) is left completely alone. Elements outside `<app>` can be a persistent static layout if you want.

## Components

### What does a component look like?

A component is a single `.html` file with up to three sections: `<template>` (required), `<script>` (optional), and `<style>` (optional).

```html
<!-- file: Card.html -->
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

### How do I use a component on a page?

Use the component's filename (without `.html`) as an HTML tag, written in PascalCase. A file called `UserCard.html` becomes `<UserCard></UserCard>` in your HTML. Chocola replaces that tag with the component's rendered output at compile time. Component names should be PascalCase (first letter capitalized).

### Can a component render content passed into it?

Yes — put a `<slot>` element in your component's HTML template. Whatever you write between the component's opening and closing tags in the parent gets rendered in that spot.

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

## Props & Data

### How do I send data into a component?

Add attributes to the component tag — those become props. Strings go in plain, everything else (numbers, booleans, variables) gets wrapped in curly braces so Chocola evaluates them properly:

```html
<Counter label="Clicks" start={5} active={true}></Counter>
```

Inside the component's `script`, you access those values through the `ctx` object: `ctx.label`, `ctx.start`, and so on.

### How do state and reactivity work?

Reactivity and state will be added in Chocola 3. As of now, manually update contents via components' `$runtime()` function and global scripts.

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

No. CSS you import into a component is automatically scoped. Chocola adds a unique hash to the component's elements under the hood. A `button { color: red }` rule in one component won't affect buttons anywhere else.

### What if I want styles that apply to the whole site?

Link a stylesheet the normal way in your `src/index.html` `<head>`. Those styles apply globally. When a component has a scoped rule that conflicts with a global one, the scoped style prevails inside that component.

## Runtime

### When does my component's script run?

Once, right after the component has been rendered into the DOM. It's the right place to attach event listeners, kick off fetches, set up timers, or anything else that needs the HTML to be there already.

### What is `self`?

- `self` is the root DOM node of your component instance. Always use `self.querySelector()` instead of `document.querySelector()` to avoid bugs when multiple instances of the same component exist.
