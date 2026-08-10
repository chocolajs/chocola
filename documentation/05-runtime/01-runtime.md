---
title: $runtime
description: Component runtime logic
---

## Script Runtime

Components can have runtime logic that runs once the component is rendered. This is where you add interactivity or logic tied to the component.

```html
<script>
    function $runtime() {
        console.log("Component rendered");
    }
</script>
```

## Context

The runtime function receives access to component data and DOM elements through injected variables:

- `self` — the root DOM element of the component.
- `ctx` — contains props and other dynamic values.

> You don't declare `self` and `ctx` as parameters — they are injected automatically at compile-time.

### Example with `self`

```html
<script>
    let self;
    export let count = 0;

    function $runtime() {
        const numDisplay = self.querySelector("#number");

        self.addEventListener("click", () => {
            if (numDisplay) {
                numDisplay.textContent = parseInt(numDisplay.textContent) + 1;
            }
        });
    }
</script>

<template>
    <div id="number">{count}</div>
</template>
```

## Top-Level Variables

You can declare `let` or `const` variables at the top level of `<script>`. They are included in the component's context, so they're available in template bindings and inside `$runtime`:

```html
<script>
    let log = "Hi";
    const price = 42;

    function $runtime() {
        console.log(log); // "Hi"
        self.querySelector(".price").textContent = price;
    }
</script>

<template>
    <p class="price">{log}: {price}</p>
</template>
```

Top-level variables are scoped to the component and won't leak. A parent-passed attribute with the same name takes precedence over the declared value.

## Top-Level Functions and Variables

You can declare functions and variables at the top level of `<script>` and call them everywhere in the component. They are scoped to the component's runtime function and won't leak to other components.

```html
<script>
    export let price = 58.645;

    let self;
    let priceTag;
    let btn;

    function format(n) {
        return n.toFixed(2);
    }

    function $runtime() {
        btn.addEventlistener("click", () => {
            format(price * 0.85)
        });
    }
</script>

<template>
    <span bind:self="priceTag">{format(price)}</span>
    <button bind:self="btn">Apply discount</button>
</template>
```

This keeps your runtime logic clean by extracting reusable logic into named functions.

## Best Practices

- Always manipulate elements inside `self` to prevent conflicts when multiple instances of a component are rendered.
- Use `$runtime` to store state that persists across renders.
- Avoid manipulating the global `document` directly inside component scripts.
