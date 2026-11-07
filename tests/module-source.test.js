import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  splitComponentSource,
  expandSelfClosingComponents,
  scanTemplateTags,
  scanImportsFallback,
  parseModuleSource,
} from "../compiler/module-source.js";
import { deterministicHash, runtimeFunctionId } from "../compiler/utils.js";

describe("module-source — splitComponentSource", () => {
  test("splits script, template, and style contents in any order", () => {
    const source =
      `<template><div>hi</div></template>\n` +
      `<script>let a = 1;</script>\n` +
      `<style>.a { color: red; }</style>`;

    assert.deepEqual(splitComponentSource(source), {
      script: "let a = 1;",
      template: "<div>hi</div>",
      styles: ".a { color: red; }",
    });
  });

  test("handles attributes on opening tags", () => {
    const source =
      `<script type="module">export let x = 1;</script>` +
      `<template id="root" data-note="1 > 0"><p>{a > b}</p></template>` +
      `<style scoped media="screen">.x{}</style>`;

    assert.deepEqual(splitComponentSource(source), {
      script: "export let x = 1;",
      template: `<p>{a > b}</p>`,
      styles: ".x{}",
    });
  });

  test("tracks nested templates so the outer template is not truncated", () => {
    const source =
      `<template><template><p>inner</p></template><div>outer</div></template>` +
      `<div>after</div>`;

    assert.equal(
      splitComponentSource(source).template,
      `<template><p>inner</p></template><div>outer</div>`
    );
  });

  test("ignores template-like strings inside a nested script/style block", () => {
    const inner = `<script>const s = "</template>";</script><style>.x{}</style><p>ok</p>`;
    const source = `<template>${inner}</template><div>after</div>`;
    assert.equal(splitComponentSource(source).template, inner);
  });

  test("skips HTML comments", () => {
    const source = `<!-- <template>fake</template> --><template>real</template>`;
    assert.equal(splitComponentSource(source).template, "real");
  });

  test("returns the first block of each kind", () => {
    const source = `<template>one</template><template>two</template>`;
    assert.equal(splitComponentSource(source).template, "one");
  });

  test("is case-insensitive", () => {
    const source = `<TEMPLATE>x</TEMPLATE><SCRIPT>y</SCRIPT><STYLE>z</STYLE>`;
    assert.deepEqual(splitComponentSource(source), {
      script: "y",
      template: "x",
      styles: "z",
    });
  });

  test("does not parse or rewrite section contents", () => {
    const template = `<div><br><img src="a.png"><p>{a < b && c > d}</p></div>`;
    assert.equal(splitComponentSource(`<template>${template}</template>`).template, template);
  });

  test("returns null for missing sections and empty source", () => {
    assert.deepEqual(splitComponentSource(`<div>hi</div>`), {
      script: null,
      template: null,
      styles: null,
    });
    assert.deepEqual(splitComponentSource(""), {
      script: null,
      template: null,
      styles: null,
    });
  });

  test("supports self-closing and unterminated section tags", () => {
    assert.equal(splitComponentSource(`<template />`).template, "");
    assert.equal(splitComponentSource(`<template>abc`).template, "abc");
  });
});

describe("module-source — expandSelfClosingComponents", () => {
  test("expands an imported component local", () => {
    assert.equal(
      expandSelfClosingComponents(`<Greeting />`, { importLocals: ["greeting"] }),
      `<Greeting></Greeting>`
    );
    assert.equal(
      expandSelfClosingComponents(`<Greeting/>`, { importLocals: new Set(["greeting"]) }),
      `<Greeting></Greeting>`
    );
  });

  test("leaves explicit pairs alone", () => {
    assert.equal(
      expandSelfClosingComponents(`<Greeting></Greeting>`, { importLocals: ["greeting"] }),
      `<Greeting></Greeting>`
    );
    assert.equal(
      expandSelfClosingComponents(`<Card><span>slot</span></Card>`, { importLocals: ["card"] }),
      `<Card><span>slot</span></Card>`
    );
  });

  test("expands namespace tags", () => {
    const options = { namespacePrefixes: ["lib"] };
    assert.equal(
      expandSelfClosingComponents(`<Lib:Card />`, options),
      `<Lib:Card></Lib:Card>`
    );
    assert.equal(
      expandSelfClosingComponents(`<Lib:Sub:Thing />`, options),
      `<Lib:Sub:Thing></Lib:Sub:Thing>`
    );
  });

  test("expands self-closing slots", () => {
    assert.equal(expandSelfClosingComponents(`<slot />`), `<slot></slot>`);
    assert.equal(expandSelfClosingComponents(`<slot name="x" />`), `<slot name="x"></slot>`);
  });

  test("leaves static void and hyphenated custom elements alone", () => {
    assert.equal(expandSelfClosingComponents(`<br />`), `<br />`);
    assert.equal(expandSelfClosingComponents(`<img src="a.png" />`), `<img src="a.png" />`);
    assert.equal(expandSelfClosingComponents(`<my-widget />`), `<my-widget />`);
  });

  test("is quote-aware for > and / in attributes", () => {
    assert.equal(
      expandSelfClosingComponents(`<A data-x="1 > 0" data-y="a/b" />`, { importLocals: ["a"] }),
      `<A data-x="1 > 0" data-y="a/b"></A>`
    );
  });

  test("keeps curly-brace interpolations intact", () => {
    const template = `<p>{a < b ? "x < y" : "z"}</p>\n<Greeting />`;
    assert.equal(
      expandSelfClosingComponents(template, { importLocals: ["greeting"] }),
      `<p>{a < b ? "x < y" : "z"}</p>\n<Greeting></Greeting>`
    );
  });

  test("skips script/style regions and comments", () => {
    const template =
      `<script>const t = "<Greeting />";</script>` +
      `<style>.x{content:"<Greeting />"}</style>` +
      `<!-- <Greeting /> -->` +
      `<Greeting />`;

    assert.equal(
      expandSelfClosingComponents(template, { importLocals: ["greeting"] }),
      `<script>const t = "<Greeting />";</script>` +
      `<style>.x{content:"<Greeting />"}</style>` +
      `<!-- <Greeting /> -->` +
      `<Greeting></Greeting>`
    );
  });

  test("does not expand explicit pairs or unknown tags", () => {
    const template = `<Other /><Card is-open />`;
    assert.equal(
      expandSelfClosingComponents(template, { importLocals: ["card"] }),
      `<Other /><Card is-open></Card>`
    );
  });
});

describe("module-source — scanTemplateTags", () => {
  test("returns source casing, index, and line", () => {
    const template = `<div>\n  <Greeting />\n  <Lib:Card />\n</div>`;
    const tags = scanTemplateTags(template);

    assert.deepEqual(
      tags.map((tag) => tag.rawName),
      ["div", "Greeting", "Lib:Card"]
    );
    assert.deepEqual(
      tags.map((tag) => tag.lowerName),
      ["div", "greeting", "lib:card"]
    );
    assert.deepEqual(
      tags.map((tag) => tag.line),
      [1, 2, 3]
    );
    assert.equal(tags[1].index, template.indexOf("<Greeting"));
  });

  test("skips closing tags, comments, doctype, and declarations", () => {
    const template = `<!DOCTYPE html><!-- <Fake /> --><div><span></span></div>`;
    assert.deepEqual(
      scanTemplateTags(template).map((tag) => tag.rawName),
      ["div", "span"]
    );
  });

  test("skips script and style regions", () => {
    const template =
      `<script>const x = "<Card />";</script>` +
      `<style>.x { content: "<Card />"; }</style>` +
      `<div />`;

    const tags = scanTemplateTags(template);
    assert.deepEqual(tags.map((tag) => tag.rawName), ["div"]);
    assert.equal(tags[0].line, 1);
  });

  test("skips attribute values", () => {
    const template = `<div title="<Greeting>" data-close=">"><span /></div>`;
    assert.deepEqual(
      scanTemplateTags(template).map((tag) => tag.rawName),
      ["div", "span"]
    );
  });

  test("skips curly-brace interpolations", () => {
    const template = `<p>{a < b && c > d}</p><Greeting />`;
    assert.deepEqual(
      scanTemplateTags(template).map((tag) => tag.rawName),
      ["p", "Greeting"]
    );
  });

  test("returns an empty array for empty input", () => {
    assert.deepEqual(scanTemplateTags(""), []);
    assert.deepEqual(scanTemplateTags(null), []);
  });
});

describe("module-source — scanImportsFallback", () => {
  test("finds default, named, namespace, and side-effect imports", () => {
    const imports = scanImportsFallback(`
      import Card from "./card.chjs";
      import { fmt as format } from "./format.js";
      import * as Lib from "./lib/";
      import "./polyfill.js";
    `);

    assert.deepEqual(
      imports.map((imp) => imp.source),
      ["./card.chjs", "./format.js", "./lib/", "./polyfill.js"]
    );
    assert.deepEqual(imports[0].specifiers, [{ type: "default", local: "Card" }]);
    assert.deepEqual(imports[1].specifiers, [
      { type: "named", imported: "fmt", local: "format" },
    ]);
    assert.deepEqual(imports[2].specifiers, [{ type: "namespace", local: "Lib" }]);
    assert.deepEqual(imports[3].specifiers, []);
  });

  test("returns an empty list for empty input", () => {
    assert.deepEqual(scanImportsFallback(""), []);
  });
});

describe("module-source — parseModuleSource", () => {
  test("splits, normalizes, and computes module fields", () => {
    const module = {
      id: "app.chjs",
      source:
        `<script>import Greeting from "./lib/greeting.chjs"; export let name = "x";</script>` +
        `<template><Greeting /><my-widget /></template>` +
        `<style>.a { color: red; }</style>`,
    };

    parseModuleSource(module);

    assert.equal(module.script, `import Greeting from "./lib/greeting.chjs"; export let name = "x";`);
    assert.equal(module.template, `<Greeting></Greeting><my-widget />`);
    assert.equal(module.styles, ".a { color: red; }");
    assert.equal(module.imports.length, 1);
    assert.deepEqual(module.compProps, [{ name: "name", defaultValue: '"x"' }]);
    assert.deepEqual(module.topFuncs, []);
    assert.deepEqual(module.topVars, []);
    assert.equal(module.templateStartLine, 1);
    assert.equal(module.cssId, deterministicHash("app.chjs", 8));
    assert.equal(module.fnId, runtimeFunctionId("app.chjs"));
  });

  test("normalizes named import locals and namespace imports", () => {
    const module = {
      id: "lib/card.chjs",
      source:
        `<script>import { Action as Act } from "./action.chjs"; import * as Lib from "./sub/";</script>` +
        `<template><Act /><Lib:Sub:Thing /></template>`,
    };

    parseModuleSource(module);

    assert.equal(
      module.template,
      `<Act></Act><Lib:Sub:Thing></Lib:Sub:Thing>`
    );
  });

  test("does not treat non-.chjs imports as component locals or namespaces", () => {
    const module = {
      id: "app.chjs",
      source:
        `<script>import fmt from "./format.js"; import * as util from "./util.js";</script>` +
        `<template><fmt /><util:Thing /></template>`,
    };

    parseModuleSource(module);

    assert.equal(module.template, `<fmt /><util:Thing />`);
  });

  test("supports script-only components", () => {
    const module = { id: "app.chjs", source: `<script>export let x = 1;</script>` };
    parseModuleSource(module);

    assert.equal(module.script, "export let x = 1;");
    assert.equal(module.template, null);
    assert.equal(module.styles, null);
    assert.deepEqual(module.compProps, [{ name: "x", defaultValue: "1" }]);
  });

  test("keeps imports when Acorn fails", () => {
    const module = {
      id: "app.chjs",
      source:
        `<script>import Card from "./card.chjs"; let = ;</script>` +
        `<template><Card /></template>`,
    };

    parseModuleSource(module);

    assert.equal(module.imports.length, 1);
    assert.equal(module.imports[0].source, "./card.chjs");
    assert.equal(module.template, `<Card></Card>`);
  });

  test("leaves explicit component pairs unchanged", () => {
    const module = {
      id: "app.chjs",
      source:
        `<script>import Card from "./card.chjs";</script>` +
        `<template><Card><span>slot</span></Card></template>`,
    };

    parseModuleSource(module);

    assert.equal(module.template, `<Card><span>slot</span></Card>`);
  });
});
