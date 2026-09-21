<picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/banner_dark.jpg">
    <img src="assets/banner.jpg" alt="Chocola • The sweetest way to build the web" />
</picture>

## What is Chocola

Chocola is a new and sweeter way to build your web apps.

No bundler config. No virtual DOM. No hydration ceremony. Just `.html` files with `<template>`, `<script>`, and `<style>` compiled to HTML with scoped CSS the browser already understands, and optional runtime when you need it.

Import components. Instantiate them. Mount, update, remove. Client-side or server-side. Same file, minimal overhead.

```html
<script>
    import CoolButton from './CoolButton.html';

    export let title = "Hello";

    let input;

    function $runtime() {
        input.focus();
    }
</script>

<template>
    <div>
        <h1>{title}</h1>
        <input bind:self="input" type="text" placeholder="Your name">
        <CoolButton label="Not lame button"></CoolButton>
    </div>
</template>

<style>
    h1 { color: chocolate; }
</style>
```

## Documentation

- [Getting started](documentation/01-introduction/02-getting-started.md)
- [Project structure](documentation/01-introduction/03-project-structure.md)
- [CLI reference](documentation/07-reference/04-cli.md)

## Quick start

```sh
npm install chocola
npx chocola dev        # dev server
npx chocola build      # production build
npx chocola serve      # SSR production server
```

No init scripts required: `chocola.config.json` is optional. See [Getting started](documentation/01-introduction/02-getting-started.md) for more.
