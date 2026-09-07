---
title: Overview
description: What is Chocola and why use it
---

Chocola is a web framework designed for simplicity and modularity. It lets you build single-file components (SFCs) — a single `.html` file containing your template, logic, and styles — and compiles them into a clean static site or renders them per request with `chocola/server`.

```html
<!-- file: Counter.html -->
<script>
    let self;

    export let start = 0;

    function $runtime() {
        const btn = self.querySelector("button");
        const number = self.querySelector(".number");

        btn.addEventListener("click", () => {
            count++;
            number.textContent = count;
        })
    }
</script>

<template>
    <button>Click me</button>
    <div class="main">
        <div class="number">{start}</div>
    </div>
</template>

<style>
    button { color: chocolate; }
</style>
```

Chocola handles the compilation for you, outputting a fully functional web app with vanilla JavaScript — no extra libraries needed.
