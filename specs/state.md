## State management

The state lifecycle in Chocola is intended to be declarative to optimize runtime and provide a better development experience by explicitly letting know the compiler what is reactive and what has to update according to it, making track of unused reactive variables or reactive casting of static variables easier.

To work with statefulness, Chocola will provide a `state` sub-module.

## `state` Sub-module

### `$cast()`

When writing the `<script>` of a component, variables can be defined as stateful using the `$cast` function:

```js
import { $cast } from 'chocola/state';

let num = $cast(0);                  // primitive
let user = $cast({ name: 'Juan' });  // object (deep reactive)
let list = $cast([1, 2, 3]);         // array (deep reactive)
```

Casting a variable propmts Chocola to create a structured class that contains its value.

### `$react()`

Stateful variables contain a `$react()` method that receives an arrow function to be triggered when the casted variable updates:

```js
import { $cast } from 'chocola/state';

let num = $cast(0);

num.$react((oldValue) => {
    console.log(oldValue); // runs when num updates and logs the previous value of num
});
```

### `$bake()`

To save a snapshot of a casted variable, use the `$bake()` function:

```js
import { $cast, $bake } from 'chocola/state';

let num = $cast(0);
let hist = [];

num.$react(() => {
    hist.push($bake(num)); // push the current value of num
    // `hist.push(num);` would push the stateful variable reference instead
    if (hist.length > 5) console.log(hist);
});
```

## Templates

### Reactive bindings `${foo}`

To work with stateful variables in templates, they must be binded as `${foo}` instead of `{foo}`. This way, the Chocola compiler will be certain what's reactive and what's not.

```html
<script>
  import { $cast } from 'chocola/state';

  let num = $cast(0);

  function sumNum() {
    num++;
  }
</script>

<template>
  <button on:click={sumNum}>Click me!</button>

  <!-- updates with num -->
  <span>${num}<span>

  <!-- will not update -->
  <span>{num}<span>
</template>
```

### Elements and components statefulness

HTML elements and Chocola components are stateful-related agnostic. You can use both `${foo}` and `{foo}` in the same tag.

Anyway, Chocola provides `$bake` and `$cast` directives to make all bindings inside a tag (be it a component or an element) override its statefulness. If you're any familiar whit Flutter, think of it as stateful and stateless widgets.


```html
<script>
import { $cast, $bake } from 'chocola/state';

let num = $cast(0);
let history = [];

function sumNum() {
  num++;
  const numSnap = $bake(num);
  history.push(numSnap);
}

num.$react(() => {
  if (num > 5) console.log(history);
});
</script>

<template>
  <button on:click={sumNum}>Click me</button>

  <!-- makes all bindings stateful -->
  <!-- overrides: <span>${num}</span> -->
  <span $cast>{num}</span>

  <span>Original value:</span>

  <!-- removes statefulnes from all bindings -->
  <!-- overrides: <span>0</span> -->
  <span $bake>${num}</span>
</template>
```

## Mental Model

The analogy is simple:

- `$cast`: When you want to make a cake, you pour the batter into a mold to cast its shape. It’s still malleable, and the different toppings you add remain separate (the batter with its toppings represents the generated Chocola primitive)
- `$react`: While the cake is baking, you keep an eye on it to make sure everything is going well. If something happens, you react accordingly, if necessary
- `$bake`: When you bake the batter, this mixture (the Chocola primitive) turns into a single solid cake (the JS primitive) that is no longer malleable