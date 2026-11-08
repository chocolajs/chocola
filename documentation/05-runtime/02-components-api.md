---
title: Components API
description: Client-side rendering components
---

In Chocola you aren't limited to static renders of your components — you can also instantiate them during runtime using the components API.

The compiler emits one ESM chunk per component module. Generated classes are exported from those chunks, so a host (or a bundler) loads them as modules instead of as a single global script.

## Instantiating a new component

Import the generated class from the runtime chunk your host serves:

```js
import { ChatBubble_ab12 as ChatBubble } from "/runtime/run-chatbubble.js";

function createBubble() {
    // reference to your new instance
    const newBubble = new ChatBubble();
}
```

The exported name is the canonical class name: `PascalCase(module basename)` plus a short hash of the module id. Use the `hashMap` and runtime descriptors returned by `render()` to identify each module's chunk.

## mount

To mount a new instance of a component in your app, use the `mount(target, props)` method.

```js
import { ChatBubble_ab12 as ChatBubble } from "/runtime/run-chatbubble.js";

function createBubble() {
    const newBubble = new ChatBubble();

    // append to the root element
    newBubble.mount(self, { msg: "Hi!" });
}
```

Props passed to `mount()` override the defaults.

## update

To change the values of the props of an instantiated component, use the `update(props)` method.

```js
import { SendButton_cd34 as SendButton } from "/runtime/run-sendbutton.js";

function $runtime() {
    const sendBtn = new SendButton();
    sendBtn.mount(self, { available: true });

    // re-renders the component with new values
    sendBtn.update({ available: false });
}
```

The component tears down and re-renders in place with the new context.

## remove

For removing an instantiated component from your app, use the `remove()` method.

```js
import { ChatBubble_ab12 as ChatBubble } from "/runtime/run-chatbubble.js";

function createBubble() {
    const newBubble = new ChatBubble();
    newBubble.mount(self, { msg: "Hi!" });

    // remove the component from your app
    setTimeout(() => {
        newBubble.remove();
    }, 5000);
}
```

All tracked event listeners are cleaned up and the DOM element is detached.

## Loading runtime chunks

`render()` returns `runtime` as an array of `{ name, content }` descriptors. The host writes or serves them. Because they are ES modules:

- load them with `<script type="module">` or let your bundler resolve them;
- keep the chunk filenames unchanged, since generated imports reference each other by name;
- keep non-`.chjs` imports resolvable from the chunk location, since the core preserves them verbatim.
