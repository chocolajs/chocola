import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  protectCurlyBraces,
  restoreCurlyBraces,
  restoreTemplateChars,
} from "../utils.js";
import {
  throwError,
  deterministicHash,
  runtimeFunctionId,
  findElementLine,
} from "../compiler/utils.js";

describe("utils — curly braces", () => {
  test("protect/restore round-trips bindings", () => {
    const html = "<div><p>Hello {name}!</p></div>";
    assert.equal(restoreCurlyBraces(protectCurlyBraces(html)), html);
  });

  test("script/style blocks are left alone", () => {
    const html = '<script>const o = {a: 1};</script><div>{x}</div>';
    const out = restoreCurlyBraces(protectCurlyBraces(html));
    assert.ok(out.includes("const o = {a: 1};"), out);
    assert.ok(out.includes("{x}"), out);
  });

  test("html entities become literal braces", () => {
    const out = restoreCurlyBraces(protectCurlyBraces("<p>&#123;hi&#125;</p>"));
    assert.ok(out.includes("{hi}"), out);
  });

  test("restoreTemplateChars restores protected chars", () => {
    const html = "<p>{a & b}</p>";
    const round = restoreTemplateChars(protectCurlyBraces(html));
    assert.ok(round.includes("a & b"), round);
  });
});

describe("utils — compiler utils", () => {
  test("deterministicHash is stable with requested length", () => {
    assert.equal(deterministicHash("greeting.html", 8), deterministicHash("greeting.html", 8));
    assert.equal(deterministicHash("greeting.html", 8).length, 8);
    assert.match(deterministicHash("x", 6), /^[a-z]{6}$/);
    assert.notEqual(deterministicHash("a.html", 8), deterministicHash("b.html", 8));
  });

  test("runtimeFunctionId prefixes the module hash", () => {
    assert.equal(runtimeFunctionId("counter.html"), "r_" + deterministicHash("counter.html", 8));
  });

  test("throwError throws an Error", () => {
    assert.throws(() => throwError("boom"), /boom/);
  });

  test("findElementLine locates an element", () => {
    const src = "<app>\n  <p>one</p>\n  <span>two</span>\n</app>";
    assert.equal(findElementLine(src, "<span>two</span>"), 3);
    assert.equal(findElementLine(src, "<missing>x</missing>"), null);
  });
});
