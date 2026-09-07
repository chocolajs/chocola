---
title: bind:*
description: Manipulate DOM elements in a safe way
---

Use `bind:*` attributes to capture DOM element references or their properties directly into script variables. Bindings are evaluated at mount time, before `$runtime` runs.

```html
<script>
    let self;
    let input;
    let inputType;

    function $runtime() {
        input.focus();
        console.log(inputType, input.value);
    }
</script>

<template>
    <div>
        <input bind:self="input" bind:type="inputType" type="text">
    </div>
</template>
```

- `bind:self="var"` — assigns the element itself to the variable.
- `bind:<property>="var"` — assigns the element's property (e.g., `value`, `type`, `innerText`).
- Multiple `bind:*` attributes on the same element share the same internal reference.