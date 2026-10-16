# Bug: Scoped component styles leak into child/nested components

**Severity:** High — breaks component style encapsulation and produces global CSS pollution.

**Affected area:** CSS scoping (`parser/css.js`), SSR component processing
(`compiler/component-processor.js`), CSR runtime (`runtime/index.js`).

**Status:** Fixed using the per-element scope token approach (option 1 below).
See [Fix](#fix-per-element-scope-token) for the implemented change.

---

## Summary

Chocola scopes a component's CSS by rewriting selectors under the component's
hash class, and it only puts that hash class on the component's **single root
element**. Selectors are rewritten with a **descendant combinator**
(`.hash sel`) for anything that is not the root. Because child components are
rendered *inside* the parent's root element, any descendant selector from the
parent also matches elements that belong to child components.

Result: a `button { ... }` rule in `Parent.html` also styles the `<button>`
inside `Child.html`, exactly the encapsulation failure described in the report.

---

## Reproduction

`src/index.html`

```html
<html><body><app><Parent></Parent></app></body></html>
```

`src/lib/Parent.html`

```html
<style>button { background-color: red; color: white; }</style>
<template>
  <div class="parent">
    <h1>Parent Component</h1>
    <Child></Child>
  </div>
</template>
```

`src/lib/Child.html`

```html
<style>button { border: 1px solid blue; }</style>
<template>
  <div class="child">
    <button>Child Button</button>
  </div>
</template>
```

### Actual output (compiler-generated)

Scoped stylesheet (`sc-*.css`):

```css
.llovtgdzbutton, .llovtgdz button{ border: 1px solid blue; }
.iavgkaxfbutton, .iavgkaxf button{ background-color: red; color: white; }
```

Rendered DOM:

```html
<app>
  <div class="parent iavgkaxf">
    <h1>Parent Component</h1>
    <div class="child llovtgdz">
      <button>Child Button</button>
    </div>
  </div>
</app>
```

The child's `<button>` is a descendant of `.iavgkaxf` (the parent's root), so
the parent rule `.iavgkaxf button { background-color: red; color: white }`
matches it. The parent styles bleed into `Child`.

### Expected output

The parent's `button` rule must not match any node owned by `Child`. The child
button should only receive `.llovtgdz button { border: 1px solid blue }`.

---

## Root cause

### 1. Selectors are scoped with a descendant combinator

`parser/css.js:11`

```js
function scopeSelector(sel, cssId) {
  const s = sel.trim();
  if (s.startsWith("." + cssId)) return s;
  if (hasCombinator(s)) return `.${cssId} ${s}`;
  return `.${cssId}${s}, .${cssId} ${s}`;
}
```

For `button`, the generated selector is:

```css
.iavgkaxfbutton, .iavgkaxf button
```

- `.iavgkaxf button` is an **any-descendant** selector. It matches every
  `button` in the entire subtree under the root, including buttons that belong
  to nested components.
- The compound form `.iavgkaxfbutton` only matches an element that has *both*
  classes (i.e. a root element that happens to be a `<button>`), so it does not
  constrain non-root elements at all.

Selectors that already contain a combinator are scoped **only** with the
descendant form (`parser/css.js:14`), which makes them unconditionally leaky
across component boundaries.

### 2. The hash class is only placed on the root element

SSR path — `compiler/component-processor.js:793`:

```js
let cssId = cx.cssScopesMap && cx.cssScopesMap.get(compName);
if (!cssId) {
  cssId = deterministicHash(compName, 8);
  cx.cssScopesMap.set(compName, cssId);
}
if (fragment.children.length === 1 && firstChild.nodeType === 1) {
  firstChild.classList.add(cssId);        // only the root gets the hash
}
if (styles) {
  styles = scopeCss(styles, cssId);
  cx.scopedStyles.push(styles);
}
```

CSR path — `runtime/index.js:231`:

```js
root.classList.add(this.#hash);           // only the root gets the hash
```

No descendant element of a component's template ever receives its own scoping
token. There is therefore no per-element boundary for the descendant selector
to respect: the boundary is assumed to be the root's subtree, but nested
components are rendered inside that subtree.

### 3. Child components render inside the parent root

In SSR, `processComponentElement` replaces the child tag with the child's
rendered fragment in-place (`compiler/component-processor.js:604`, and the
`element.replaceWith(fragment)` at the end of the processor). In CSR,
`#mountChildren` mounts child instances into the parent's baked root
(`runtime/index.js:255`). Both place child DOM *inside* the parent's hashed
root, so the parent's descendant selectors reach it.

### 4. All scoped rules are emitted into one global stylesheet

`render.js:167` concatenates every component's scoped CSS into a single
`sc-*.css` file:

```js
const scopesCss = cx.scopedStyles.join("\n");
```

Because the emitted selectors are ordinary CSS with no per-element scoping
attribute, the leak applies globally once that file is loaded — for SSR, CSR,
and any combination of the two.

---

## Scope of impact

- Any component with a `<style>` block whose selectors target non-root
  elements (the common case: `button`, `.foo`, `ul li`, `a:hover`, etc.).
- Worsens with nesting depth: a style on a high-level ancestor applies to every
  matching element in every descendant component.
- Both rendering modes are affected:
  - **SSR**: leak visible in the emitted HTML + scoped stylesheet.
  - **CSR**: `root.classList.add(this.#hash)` reproduces the same structure.
- Slotted content is also affected. `processSlots` (`runtime/index.js:123`)
  clones projected children into the consuming component's subtree; those nodes
  carry no scoping token of their own, so they are matched by whichever ancestor
  hash happens to wrap them.
- `:root` handling (`parser/css.js:57`) does not help, since it maps to the same
  root-only class.

This also contradicts the documented promise in
`documentation/04-styling/01-scoped-styles.md:25` ("The `button` rule above will
only apply to `<button>` elements inside this component") and the FAQ entry at
`documentation/07-reference/01-faq.md:113`.

---

## Why the current design cannot enforce the boundary

A root-only hash plus descendant selectors is a *subtree* scope, not a
*component-ownership* scope. For the latter, each DOM node must carry a token
identifying which component introduced it, and the selector must require the
token on the element it matches (or on the nearest relevant ancestor), so that
a node owned by `Child` can never satisfy a selector written in `Parent`.

---

## Fix (per-element scope token)

Implemented in this change (option 1 below):

- **Every element gets an ownership token.** On SSR, `processComponentElement`
  calls `tagDescendants(fragment, cssId)` right after the component template is
  parsed (before slots are filled), so only elements authored by the component
  are tagged. Elements belonging to nested components are tagged later with
  their own token, and slotted content keeps the token of the component that
  authored it. On CSR, `runtime/index.js` calls `applyScopeAttributes(root, hash)`
  before `processSlots`, with the same ownership semantics.
- **Selectors require the token.** `parser/css.js` now rewrites `button` to
  `button[data-sc-<hash>]` instead of `.hash button, .hashbutton`. The attribute
  is appended to the rightmost compound selector, before any pseudo-element
  (`a:hover` -> `a:hover[data-sc-<hash>]`, `.x::before` ->
  `.x[data-sc-<hash>]::before`). `:root` still maps to the root hash class.
- **Root hash class retained.** The deterministic root class is kept for
  identification (`.chocola/hashes.json`, error messages) and is independent of
  scoping, so a parent's selectors can no longer reach a child's elements.

Regression tests:
- `tests/compiler.test.js` — "scoped styles do not leak into nested child
  components" asserts the child button carries only the child token and that no
  descendant-scoped selector is emitted.
- `tests/runtime.test.js` — "nested components keep their own scope token (no
  leak)" covers the CSR path.
- `tests/parser.test.js` — covers combinators and pseudo-element insertion.

### Alternatives considered

1. **Per-element scope token (Vue/Svelte-style).** Chosen; see above.
2. **Direct-child / `:where()` boundary.** Rewrite `.hash sel` to
   `.hash sel:not(.hash *)`. Cheaper to emit, but fragile with deeply nested or
   multiply-hashed subtrees.
3. **Reset hash on child roots.** Keep root-only scoping but explicitly strip
   inheritance at component boundaries. Not sufficient on its own because
   descendant selectors from an ancestor still match nested owned nodes.

---

## References

- `parser/css.js:11` — `scopeSelector` (descendant/combinator scoping)
- `parser/css.js:18` — `scopeCss` entry point
- `compiler/component-processor.js:793` — root-only hash on SSR
- `runtime/index.js:231` — root-only hash on CSR
- `render.js:167` — scoped CSS emitted as one global stylesheet
- `documentation/04-styling/01-scoped-styles.md`
- `documentation/07-reference/01-faq.md`
