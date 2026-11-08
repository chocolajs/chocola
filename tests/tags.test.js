import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  KNOWN_HTML_TAGS,
  isStaticTag,
  levenshtein,
  suggestTag,
} from "../compiler/tags.js";

describe("tags — isStaticTag", () => {
  test("common HTML tags are static", () => {
    for (const tag of [
      "a", "div", "span", "p", "button", "form", "input", "img", "br",
      "section", "table", "template", "script", "style", "slot", "video",
    ]) {
      assert.equal(isStaticTag(tag), true, tag);
    }
  });

  test("SVG tags are static", () => {
    for (const tag of [
      "svg", "path", "circle", "rect", "lineargradient", "foreignobject", "textpath",
    ]) {
      assert.equal(isStaticTag(tag), true, tag);
    }
  });

  test("MathML tags are static", () => {
    for (const tag of ["math", "mi", "mn", "mo", "mrow", "mfrac", "msqrt", "mtable"]) {
      assert.equal(isStaticTag(tag), true, tag);
    }
  });

  test("hyphenated custom elements are static", () => {
    assert.equal(isStaticTag("my-widget"), true);
    assert.equal(isStaticTag("x-foo"), true);
  });

  test("app is not a static tag", () => {
    assert.equal(KNOWN_HTML_TAGS.has("app"), false);
    assert.equal(isStaticTag("app"), false);
  });

  test("unknown capitalized components are not static", () => {
    assert.equal(isStaticTag("greeting"), false);
    assert.equal(isStaticTag("card"), false);
    assert.equal(isStaticTag("lib:card"), false);
  });
});

describe("tags — suggestions", () => {
  test("levenshtein computes edit distance", () => {
    assert.equal(levenshtein("kitten", "sitting"), 3);
    assert.equal(levenshtein("card", "card"), 0);
    assert.equal(levenshtein("", "abc"), 3);
  });

  test("suggests a case-insensitive prefix match", () => {
    assert.equal(suggestTag("Greet", ["Greeting"]), "Greeting");
    assert.equal(suggestTag("card", ["Card"]), null, "lowercase tags get no suggestion");
  });

  test("suggests a near miss within distance 2", () => {
    assert.equal(suggestTag("Greting", ["Greeting"]), "Greeting");
    assert.equal(suggestTag("Crad", ["Card"]), "Card");
  });

  test("returns null when no candidate is close", () => {
    assert.equal(suggestTag("Greeting", ["Counter", "Action"]), null);
    assert.equal(suggestTag("Greeting", ["Greeting"]), null, "exact match needs no suggestion");
  });

  test("suggests namespace tags", () => {
    assert.equal(suggestTag("Lib:Crad", ["Lib:Card", "Lib:Action"]), "Lib:Card");
    assert.equal(suggestTag("Lib:Card", ["Lib:Card"]), null);
  });

  test("only capitalized tags get suggestions", () => {
    assert.equal(suggestTag("greeting", ["Greeting"]), null);
    assert.equal(suggestTag("lib:card", ["Lib:Card"]), null);
    assert.equal(suggestTag("", ["Greeting"]), null);
  });

  test("is deterministic when several candidates tie", () => {
    assert.equal(suggestTag("Caad", ["Card", "Cabd"]), "Cabd");
  });
});
