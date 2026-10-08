import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";

import { scopeCss } from "../parser/css.js";
import {
  getLineNumber,
  validateChainStructure,
  applyConditionalToElement,
  interpolateNode,
} from "../parser/template.js";
import { compileExpr, evaluateConstant } from "../parser/utils.js";
import {
  extractPropsDefaults,
  extractRuntime,
  extractTopLevelVariables,
  extractTopLevelFunctions,
} from "../parser/component.js";
import {
  extractCtxFromEl,
  hasMountIf,
  getMountIf,
  removeMountIf,
} from "../parser/context.js";

function el(html) {
  return parseHTML(html).document.firstElementChild;
}

describe("parser — scopeCss", () => {
  test("simple selectors get dual scoping", () => {
    const out = scopeCss(".foo { color: red; }", "abc");
    assert.ok(out.includes(".abc.foo"), `AND variant missing: ${out}`);
    assert.ok(out.includes(".abc .foo"), `descendant variant missing: ${out}`);
  });

  test(":root maps to the scope class", () => {
    const out = scopeCss(":root { color: red; } :root:hover { color: blue; }", "abc");
    assert.ok(out.includes(".abc"), out);
    assert.ok(!out.includes(":root"), `unscoped :root remains: ${out}`);
  });

  test("combinators use descendant scoping only", () => {
    const out = scopeCss(".a > .b { color: red; }", "abc");
    assert.ok(out.includes(".abc .a > .b"), out);
  });

  test("@media inner rules are scoped, @keyframes renamed", () => {
    const out = scopeCss(
      "@media (min-width: 10px) { .foo { color: red; } } @keyframes spin { to { opacity: 1; } } .x { animation: spin 1s; }",
      "abc"
    );
    assert.ok(out.includes(".abc.foo") || out.includes(".abc .foo"), `media inner not scoped: ${out}`);
    assert.ok(out.includes("spin-abc"), `keyframe not renamed: ${out}`);
  });
});

describe("parser — chain structure and conditionals", () => {
  test("elif/else without if throws with location", () => {
    const parent = el("<div><p elif=\"{x}\">oops</p></div>");
    assert.throws(
      () => validateChainStructure(parent, "page.html", "<template><p elif=\"{x}\">oops</p></template>", parent.innerHTML),
      /elif without a preceding/
    );
  });

  test("valid if/elif/else chain passes", () => {
    const parent = el("<div><p if=\"{a}\">1</p><p elif=\"{b}\">2</p><p else>3</p></div>");
    assert.doesNotThrow(() => validateChainStructure(parent, "page.html", null, null));
  });

  test("applyConditionalToElement: if=false hides, mount:if=false removes", () => {
    const proxy = new Proxy({ a: false, b: false }, { has: () => true, get: (t, k) => t[k] });
    const hidden = el("<div><p if=\"{a}\">x</p></div>").firstElementChild;
    applyConditionalToElement(hidden, proxy, { active: false, rendered: false }, true, false, false, false);
    assert.equal(hidden.style.display, "none");
    assert.ok(!hidden.hasAttribute("if"));

    const removed = el("<div><p mount:if=\"{b}\">x</p></div>").firstElementChild;
    const holder = removed.parentNode;
    applyConditionalToElement(removed, proxy, { active: false, rendered: false }, false, true, false, false);
    assert.equal(holder.children.length, 0);
  });

  test("interpolateNode substitutes text bindings", () => {
    const root = el("<div><p>Hello {name}!</p></div>");
    const proxy = new Proxy({ name: "Ada" }, { has: () => true, get: (t, k) => t[k] });
    interpolateNode(root, proxy);
    assert.ok(root.textContent.includes("Hello Ada!"));
  });

  test("getLineNumber counts lines within same content", () => {
    const src = "<a>\n<b>\n<c>";
    assert.equal(getLineNumber(src, src, src.indexOf("<c>")), 3);
  });
});

describe("parser — compileExpr and evaluateConstant", () => {
  test("compileExpr evaluates with and without ctx", () => {
    assert.equal(compileExpr("1 + 2", false)(), 3);
    const proxy = new Proxy({ n: 21 }, { has: () => true, get: (t, k) => t[k] });
    assert.equal(compileExpr("n * 2", true)(proxy), 42);
  });

  test("evaluateConstant detects constants", () => {
    assert.deepEqual(evaluateConstant("1 + 2"), { constant: true, value: 3 });
    assert.equal(evaluateConstant("true").constant, true);
    assert.equal(evaluateConstant("someVar").constant, false);
  });
});

describe("parser — component extraction", () => {
  test("extractPropsDefaults maps defaults", () => {
    const props = extractPropsDefaults(`export let title = "Card"; export let count = 0; export let missing;`);
    assert.deepEqual(props.map((p) => p.name), ["title", "count", "missing"]);
    assert.equal(props[0].defaultValue, '"Card"');
    assert.equal(props[2].defaultValue, undefined);
  });

  test("extractRuntime finds sync and async $runtime", () => {
    assert.ok(extractRuntime(`function $runtime(){ foo(); }`).includes("$runtime"));
    assert.ok(extractRuntime(`async function $runtime(){ await foo(); }`).startsWith("async function $runtime"));
    assert.equal(extractRuntime(`let a = 1;`), null);
  });

  test("extractTopLevelVariables expands destructuring, skips self/ctx", () => {
    const vars = extractTopLevelVariables(`let self; const {a, b} = obj; let c = 1;`);
    const names = vars.map((v) => v.name);
    assert.ok(names.includes("a") && names.includes("b") && names.includes("c"));
    assert.ok(!names.includes("self"));
  });

  test("extractTopLevelFunctions excludes $runtime", () => {
    const funcs = extractTopLevelFunctions(`function helper(){ return 1; } function $runtime(){ helper(); }`, "$runtime");
    assert.equal(funcs.length, 1);
    assert.ok(funcs[0].includes("helper"));
  });
});

describe("parser — context helpers", () => {
  test("extractCtxFromEl: strings as-is, braces evaluated", () => {
    const node = el(`<div label="Clicks" start="{5}" name="{user}"></div>`);
    const ctx = extractCtxFromEl(node, { user: "Ada" });
    assert.equal(ctx.label, "Clicks");
    assert.equal(ctx.start, 5);
    assert.equal(ctx.name, "Ada");
  });

  test("mount:if helpers", () => {
    const node = el(`<div mount:if="{show}">x</div>`);
    assert.equal(hasMountIf(node), true);
    assert.equal(getMountIf(node), "{show}");
    removeMountIf(node);
    assert.equal(hasMountIf(node), false);
  });
});
