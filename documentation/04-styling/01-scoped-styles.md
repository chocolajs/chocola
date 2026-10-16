---
title: Scoped styles
description: Encapsulated styles for your components
---

Chocola components support scoped styles — CSS included in a component only affects elements inside that component. Chocola marks every element of a component with a unique scope attribute (`data-sc-<hash>`) so the styles don't leak outside, including into nested child components.

### Usage

Add a `<style>` tag to your component:

```html
<!-- file: MyComponent.html -->
<template>
    <button>Click me</button>
</template>

<style>
    button {
        color: white;
    }
</style>
```

The `button` rule above will only apply to `<button>` elements inside this component.

To apply styles to your root element, use `:root` as a placeholder selector:

```html
<style>
    :root {
        color: red;
    }

    :root:hover {
        color: blue;
    }
</style>
```

> Scoped styles automatically take priority over global styles inside the component.

### Component identification

Every component's root element receives a deterministic hash class derived from the component's filename (e.g. `button.html` produces a stable class like `xqkfybnh`). This class is always present, even on components without styles, and can be used to identify which component rendered a given element when inspecting the output or reporting errors.

The mapping of component filenames to their hash classes is written to `.chocola/hashes.json` after each build for reference:

```json
{
  "button.html": "xqkfybnh",
  "card.html": "mptzrwxj"
}
```

This file is auto-generated and should be ignored by version control.
