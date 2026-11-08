---
title: Using components
description: How to import and use Chocola components
---

Once you have created your Chocola components, import them into the file that uses them.

## Import before use

```html
<!-- file: app.chjs -->
<script>
    import Counter from "./Counter.chjs";
</script>

<template>
    <Counter start={5} label="Clicks" />
</template>
```

Rules:

- The import path is resolved relative to the importing `.chjs` file.
- The local import name becomes the tag name. `import Counter` renders as `<Counter>`.
- A tag with no matching import is a compile error with the module id, line, and a suggestion when a close name exists.
- Components are never discovered from the filesystem; only imported `.chjs` modules enter the graph.

## Tag names

Component tags use the local import name:

```html
<script>
    import UserProfile from "./UserProfile.chjs";
    import TodoItem from "./TodoItem.chjs";
</script>

<template>
    <UserProfile />
    <TodoItem />
</template>
```

Self-closing tags and explicit pairs are both supported:

```html
<Counter start={5} />
<Counter start={5}></Counter>
```

Hyphenated tags are treated as native custom elements and require an explicit closing tag:

```html
<my-widget></my-widget>
```

## Passing props

Props are custom attributes that map to `export let` declarations in the component's `<script>`.

```html
<Counter start={5} label="Clicks"></Counter>
```

- String values are passed as-is.
- Expressions, numbers, booleans, and other dynamic values must be wrapped in `{ }` to be evaluated.
- If a prop is not provided by the parent, its default value is used.

## Projecting content with slots

A component can render the content written between its tags with `<slot>`:

```html
<!-- file: Card.chjs -->
<template>
    <div class="card">
        <h2>{title}</h2>
        <slot></slot>
    </div>
</template>
```

```html
<!-- usage -->
<Card title="Hello">
    <p>Hello from the parent</p>
</Card>
```

The slot is replaced with the parent's markup at compile time.

## Namespace imports

Import a directory to use several components under one prefix:

```html
<script>
    import * as Lib from "./lib/";
</script>

<template>
    <Lib:Card />
    <Lib:Sub:Thing />
</template>
```

- `Lib:Card` resolves `lib/Card.chjs`.
- `Lib:Sub:Thing` resolves `lib/Sub/Thing.chjs`.
- Directory namespaces inspect their `.chjs` files eagerly.
- Prefix collisions and missing namespace components are compile errors.

Non-`.chjs` namespace imports are preserved as host imports instead of being expanded.

## Example

```html
<!-- file: app.chjs -->
<script>
    import Counter from "./Counter.chjs";
</script>

<template>
    <main>
        <Counter title="Increment Count" start={5} label="Clicks" />
    </main>
</template>
```

After Chocola compiles the app, each imported component tag is replaced with the component's rendered output.
