---
title: Component fundamentals
description: Anatomy of a Chocola component — template, script, and styles
---

In Chocola, everything you build is a component. A component is a combination of HTML, CSS, and JavaScript logic that gets compiled and rendered into your app automatically. Components make your app modular, reusable, and easier to maintain.

A component is a single `.chjs` file with up to three sections, all optional:

- `<template>` — the HTML markup.
- `<style>` — scoped CSS.
- `<script>` — runtime logic and prop declarations.

```html
<!-- file: MyComponent.chjs -->
<script>
    export let title = "Default";
    export let count = 0;

    function $runtime() {
        // runs once when the component is mounted
    }
</script>

<template>
    <h1>{title}</h1>
    <p>Count: {count}</p>
</template>

<style>
    h1 { color: chocolate; }
</style>
```

A `.chjs` file containing only a `<script>` is valid and renders nothing. Components enter the graph only when another `.chjs` file imports them.

## `<template>` — HTML Markup

The template contains the component's HTML. It supports bindings via `{expr}`, conditionals (`if`, `mount:if`, `elif`, `else`), `<slot>` for content projection, `<void>` as a transparent wrapper, and `bind:*` for DOM element references.

```html
<template>
    <h1>{title}</h1>
    <div if={isVisible}>Conditional content</div>
    <slot></slot>
</template>
```

Bindings are one-time substitutions, baked at compile-time. Reactive bindings are coming in a future version.

## `<style>` — Scoped CSS

CSS placed inside `<style>` is automatically scoped to the component — it won't leak out and affect other components.

```html
<style>
    button {
        color: chocolate;
    }
</style>
```

Use `:root` as a placeholder for the component's root element:

```html
<style>
    :root {
        color: red;
    }
</style>
```

Scoped CSS is returned by the compiler as a string. The host decides whether to inline it, serve it as a file, or feed it into a bundler.

## `<script>` — Props and Runtime

The `<script>` section has three roles:

### 1. Prop declarations with `export let`

Declare component props with optional default values:

```html
<script>
    export let display = true;
    export let title;
    export let count = 0;
</script>
```

Props without a default value (like `title` above) default to `undefined` unless provided by the parent.

### 2. Top-level variables and functions

Any `let` or `const` declared at the top level of `<script>` becomes part of the component's context. Their values are available in template bindings and inside `$runtime`:

```html
<script>
    let log = "Hi";
    const maxItems = 10;
    const double = (n) => n * 2;

    function $runtime() {
        console.log(log); // "Hi"
    }
</script>

<template>
    <div>{log} {maxItems} {double(5)}</div>
</template>
```

Top-level variables are scoped to the component and won't leak. Use them for internal state that templates and `$runtime` can share. A parent-passed attribute with the same name takes precedence.

### 3. Runtime function

```js
function $runtime() {
    // component logic
}
```

`$runtime` runs once after the component is rendered. It receives `self` (the root element) and `ctx` (props and state) as injected parameters — you don't declare them in the signature.

You can also declare helper functions at the top level of `<script>` and call them from `$runtime`. They are scoped to the component and won't leak.

```html
<script>
    export let label = "Click me";
    export let count = 0;

    function $runtime() {
        const btn = self.querySelector("button");
        btn.addEventListener("click", () => {
            count++;
        });
    }
</script>
```

## Importing other components

Use a component by importing it into the script of the file that renders it:

```html
<!-- file: app.chjs -->
<script>
    import Counter from "./Counter.chjs";
</script>

<template>
    <Counter start={3} />
</template>
```

The local import name becomes the tag name.
