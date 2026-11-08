---
title: Basic markup
description: Attributes, props and bindings
---

## Tags

Chocola uses HTML syntax for creating layouts. Lowercase tags like `<div>` denotes regular HTML tags, while uppercase tags like `<Widget>` indicates a _component_.

```html
<script>
	import Widget from './Widget.chjs';
</script>

<template>
  <div>
    <Widget />
  </div>  
</template>
```

## Element Attributes

Attributes in Chocola work the same as HTML attributes.

```html
<div class="foo"></div>
```

They may be unquoted just like in HTML.

```html
<input type=checkbox />
```

Attribute values can contain JavaScript expressions.

```html
<a href="page/{p}">page {p}</a>
```

Or they can be JavaScript expressions.

```html
<button disabled="{!clickable}">...</button>
```

It's recommended to wrap expression bindings inside double quote marks (`""`) when used as attributes or props values to prevent JS syntax from breaking HTML parsing.

## Component Props

Props are values passed to a component's context. They do not appear as HTML attributes in the DOM.

```html
<Widget text="Some text" color="{myColor}" />
```

## Text Interpolation

You can insert JS expressions or props directly into HTML with `{}` bindings.

```html
<div>
  <h1>{title}</h1>
  <div>The time is {time ?? "00:00"}</div>
</div>
```

> TIP: To write literal curly braces (`{`, `}`), use their HTML entities, such as `&#123;` and `&#125;`.