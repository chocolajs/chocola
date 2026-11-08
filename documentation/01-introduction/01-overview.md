---
title: Overview
description: What is Chocola and why use it
---

Chocola is a JavaScript library for building single-file components (SFCs) — a single `.chjs` file containing your template, logic, and styles.

```html
<!-- file: Counter.chjs -->
<script>
    export let start = 0;

    let number;
    let button;

    function $runtime() {
        let count = start;
        number.textContent = count;

        button.addEventListener("click", () => {
            count++;
            number.textContent = count;
        });
    }
</script>

<template>
    <button bind:self="button">Click me</button>
    <div class="number" bind:self="number">{start}</div>
</template>

<style>
    button { color: chocolate; }
</style>
```

Chocola handles the compilation for you, outputting a fully functional web app with vanilla JavaScript — no extra libraries needed.
