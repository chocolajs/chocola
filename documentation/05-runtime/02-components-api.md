---
title: Components API
description: Client-side rendering components
---

In Chocola you aren't limited to static renders of your components — you can also instantiate them during runtime using the components API.

## Instantiating a new component

Create a new instance in memory by importing a component in your script.

```js
import ChatBubble from "./ChatBubble.html";

let self;

function createBubble() {
    // reference to your new instance
    const newBubble = new ChatBubble();
}
```

## mount

To mount a new instance of a component in your app, use the `mount(target, props)` method of the components API.

```js
import ChatBubble from "./ChatBubble.html";

let self;

function createBubble() {
    const newBubble = new ChatBubble();

    // append to the root element
    newBubble.mount(self, { msg: "Hi!" })
}
```

Props passed to `mount()` override the defaults.

## update

To change the values of the props of an instantiated component, use the `update(props)` method.

```js
import SendButton from "./SendButton.html";

let self;

function $runtime() {
    const sendBtn = new SendButton();
    sendBtn.mount(self, { available: true });

    // re-renders the component with new values
    sendBtn.update({ available: false });
}
```

The component tears down and re-renders in place with the new context.

## remove

For removing a instantiated component from your app, use the `remove()` method.

```js
import ChatBubble from "./ChatBubble.html";

let self;

function createBubble() {
    const newBubble = new ChatBubble();
    newBubble.mount(self, { msg: "Hi!" });

    // remove the component from your app
    setTimeout(() => {
        newBubble.remove();
    }, 5000)
}
```

All tracked event listeners are cleaned up and the DOM element is detached.