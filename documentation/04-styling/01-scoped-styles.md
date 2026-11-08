---
title: Scoped styles
description: Encapsulated styles for your components
---

Chocola components support scoped styles — CSS included in a component only affects elements inside that component. Chocola marks every element of a component with a unique scope attribute (`data-sc-<hash>`) so the styles don't leak outside, including into nested child components.


```html
<style>
    button {
        color: white;
    }
</style>
```

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