import { test } from "node:test";
import assert from "node:assert/strict";
import { parseScript, computeReachable } from "./script.js";

test("parseScript: simple let/const and props", () => {
  const { props, topVars } = parseScript(`export let title = "Card"; let a = 1, b = 2; const c = 3;`);
  assert.deepEqual(props.map(p=>p.name), ["title"]);
  assert.equal(props[0].defaultValue, '"Card"');
  assert.deepEqual(topVars.map(v=>v.name), ["a","b","c"]);
});

test("parseScript: destructuring object and array", () => {
  const { topVars } = parseScript(`const {x,y} = obj; let [p, ...rest] = arr; const {a: aa, b: bb} = obj2;`);
  assert.equal(topVars.length, 3);
  assert.deepEqual(topVars[0].names, ["x","y"]);
  assert.equal(topVars[0].isDestructuring, true);
  assert.deepEqual(topVars[1].names, ["p","rest"]);
  assert.deepEqual(topVars[2].names, ["aa","bb"]);
});

test("parseScript: comma declarators", () => {
  const { topVars } = parseScript(`let a = 1, b = 2, c;`);
  assert.equal(topVars.length, 3);
  assert.equal(topVars[0].name, "a");
  assert.equal(topVars[0].value, "1");
  assert.equal(topVars[1].name, "b");
  assert.equal(topVars[2].name, "c");
  assert.equal(topVars[2].value, undefined);
});

test("parseScript: imports default/named/namespace/side-effect", () => {
  const { imports } = parseScript(`
    import Action from "./Action.html";
    import {x} from "./lib.js";
    import * as ns from "./ns.js";
    import "./polyfill.js";
    import {y as z} from "./lib.js";
  `);
  assert.equal(imports.length, 5);
  assert.equal(imports[0].specifiers[0].type, "default");
  assert.equal(imports[0].specifiers[0].local, "Action");
  assert.equal(imports[1].specifiers[0].type, "named");
  assert.equal(imports[2].specifiers[0].type, "namespace");
  assert.equal(imports[3].specifiers.length, 0);
  assert.equal(imports[4].specifiers[0].imported, "y");
  assert.equal(imports[4].specifiers[0].local, "z");
});

test("parseScript: comments containing function $runtime are ignored", () => {
  const { runtime, topVars } = parseScript(`let a = 1; // function $runtime(){ fake }
  /* function $runtime(){ fake } */
  function $runtime(){ a++ }`);
  assert.ok(runtime && runtime.includes("$runtime"));
  assert.equal(topVars.length, 1);
  assert.equal(topVars[0].name, "a");
});

test("parseScript: nested braces in template literals not confused", () => {
  const { topFuncs } = parseScript("function foo(){ return `a {b} c`; } function $runtime(){ foo(); }");
  assert.equal(topFuncs.length, 1);
  assert.ok(topFuncs[0].includes("foo"));
});

test("parseScript: async $runtime", () => {
  const { runtime } = parseScript(`async function $runtime(){ await fetch(); }`);
  assert.ok(runtime && runtime.startsWith("async function $runtime"));
});

test("computeReachable: transitive closure", () => {
  const parsed = parseScript(`let a = b + 1; let b = 2; let unused = 99; function foo(){ return a; } function bar(){ return unused; } function $runtime(){ foo(); }`);
  const reach = computeReachable(parsed, {bindings: []});
  assert.ok(reach.neededVars.some(v=> v.names.includes("a")));
  assert.ok(reach.neededVars.some(v=> v.names.includes("b")));
  assert.equal(reach.neededVars.some(v=> v.names.includes("unused")), false);
  assert.ok(reach.neededFuncs.some(s=> s.includes("foo")));
  assert.equal(reach.neededFuncs.some(s=> s.includes("bar")), false);
});

test("computeReachable: bindings only if referenced", () => {
  const parsed = parseScript(`let count = 0; function inc(){ count++; } function $runtime(){ inc(); btn.addEventListener("click", inc); }`);
  const reach = computeReachable(parsed, {bindings: ["btn","span"]});
  assert.deepEqual(reach.neededBindings, ["btn"]);
});

test("computeReachable: props only if referenced", () => {
  const parsed = parseScript(`export let title = "Card"; export let unused = "hi"; function $runtime(){ console.log(title); }`);
  const reach = computeReachable(parsed, {bindings: []});
  assert.deepEqual(reach.neededProps.map(p=>p.name), ["title"]);
});

test("computeReachable: no runtime -> empty", () => {
  const parsed = parseScript(`let a = 1; function foo(){}`);
  const reach = computeReachable(parsed, {bindings: []});
  assert.equal(reach.neededVars.length, 0);
  assert.equal(reach.neededFuncs.length, 0);
});

test("computeReachable: dynamic fallback", () => {
  const parsed = parseScript(`let a = 1; function $runtime(){ eval("a"); }`);
  const reach = computeReachable(parsed, {bindings: []});
  assert.equal(reach.fallback, true);
  assert.ok(reach.neededVars.length > 0);
});
