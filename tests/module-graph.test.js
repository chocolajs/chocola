import { test, describe } from "node:test";
import assert from "node:assert/strict";
import path from "path";

import {
  buildModuleGraph,
  ChocolaModule,
  ModuleGraph,
} from "../compiler/module-graph.js";
import { deterministicHash } from "../compiler/utils.js";
import { mkTmpApp, cleanupTmp } from "./helpers.js";

async function withApp(files, fn) {
  const { tmpParent, tmpRoot } = await mkTmpApp(files);
  try {
    return await fn(tmpRoot);
  } finally {
    await cleanupTmp(tmpParent);
  }
}

const greeting = `<template><p>Hello</p></template>`;

describe("module-graph — entry validation", () => {
  test("rootDir must be absolute", async () => {
    await assert.rejects(
      () => buildModuleGraph("relative/dir", { entry: "app.chjs" }),
      /rootDir must be an absolute path/
    );
  });

  test("entry is required", async () => {
    await withApp({ "app.chjs": `<template><div /></template>` }, async (root) => {
      await assert.rejects(
        () => buildModuleGraph(root),
        /entry is required; pass \{ entry: "<path to root \.chjs>" \}/
      );
    });
  });

  test("entry must point to a .chjs component", async () => {
    await withApp({ "app.html": `<template><div /></template>` }, async (root) => {
      await assert.rejects(
        () => buildModuleGraph(root, { entry: "app.html" }),
        /entry must point to a \.chjs component/
      );
    });
  });

  test("reports a missing root file", async () => {
    await withApp({}, async (root) => {
      await assert.rejects(
        () => buildModuleGraph(root, { entry: "missing.chjs" }),
        /Cannot read entry "missing\.chjs"/
      );
    });
  });

  test("accepts absolute entry paths", async () => {
    await withApp({ "app.chjs": `<template><div /></template>` }, async (root) => {
      const graph = await buildModuleGraph(root, {
        entry: path.join(root, "app.chjs"),
      });
      assert.equal(graph.entry, "app.chjs");
      assert.equal(graph.root.id, "app.chjs");
    });
  });
});

describe("module-graph — import-only discovery", () => {
  test("builds root module fields and normalizes self-closing tags", async () => {
    const source =
      `<script>import Greeting from "./lib/greeting.chjs"; export let name = "x";</script>` +
      `<template><Greeting /></template>` +
      `<style>.a { color: red; }</style>`;

    await withApp({ "app.chjs": source, "lib/greeting.chjs": greeting }, async (root) => {
      const graph = await buildModuleGraph(root, { entry: "app.chjs" });

      assert.ok(graph instanceof ModuleGraph);
      assert.ok(graph.root instanceof ChocolaModule);
      assert.equal(graph.root.isRoot, true);
      assert.equal(graph.root.id, "app.chjs");
      assert.equal(graph.root.script.includes("import Greeting"), true);
      assert.equal(graph.root.template, `<Greeting></Greeting>`);
      assert.equal(graph.root.styles, ".a { color: red; }");
      assert.equal(graph.root.cssId, deterministicHash("app.chjs", 8));
      assert.equal(graph.root.fnId, "r_" + deterministicHash("app.chjs", 8));
    });
  });

  test("resolves imports relative to the importing file", async () => {
    const app =
      `<script>import Page from "./views/page.chjs";</script>` +
      `<template><Page /></template>`;
    const page =
      `<script>import Card from "../lib/card.chjs";</script>` +
      `<template><Card /></template>`;

    await withApp(
      {
        "app.chjs": app,
        "views/page.chjs": page,
        "lib/card.chjs": `<template><b>card</b></template>`,
      },
      async (root) => {
        const graph = await buildModuleGraph(root, { entry: "app.chjs" });

        assert.deepEqual(
          [...graph.modules.keys()].sort(),
          ["app.chjs", "lib/card.chjs", "views/page.chjs"]
        );
        assert.deepEqual([...graph.root.deps], ["views/page.chjs"]);
        assert.deepEqual([...graph.moduleById("views/page.chjs").deps], ["lib/card.chjs"]);
      }
    );
  });

  test("does not discover unimported components or non-.chjs files", async () => {
    const app =
      `<script>import Used from "./lib/used.chjs"; import { fmt } from "./lib/format.js";</script>` +
      `<template><Used /></template>`;

    await withApp(
      {
        "app.chjs": app,
        "lib/used.chjs": `<template><p>used</p></template>`,
        "lib/unused.chjs": `<template><p>unused</p></template>`,
        "lib/format.js": `export const fmt = (x) => x;`,
      },
      async (root) => {
        const graph = await buildModuleGraph(root, { entry: "app.chjs" });

        assert.deepEqual([...graph.modules.keys()].sort(), ["app.chjs", "lib/used.chjs"]);
        assert.equal(graph.moduleById("lib/unused.chjs"), undefined);
        assert.equal(graph.moduleById("lib/format.js"), undefined);
        assert.equal(graph.root.imports.length, 2);
        assert.equal(graph.root.imports[1].source, "./lib/format.js");
        assert.deepEqual([...graph.root.deps], ["lib/used.chjs"]);
      }
    );
  });

  test("reports a missing .chjs import", async () => {
    const app =
      `<script>import Missing from "./missing.chjs";</script>` +
      `<template><div /></template>`;

    await withApp({ "app.chjs": app }, async (root) => {
      await assert.rejects(
        () => buildModuleGraph(root, { entry: "app.chjs" }),
        /Cannot resolve import "\.\/missing\.chjs" from app\.chjs/
      );
    });
  });

  test("side-effect imports add a dependency but no tag binding", async () => {
    const app =
      `<script>import "./lib/side.chjs";</script>` +
      `<template><div /></template>`;

    await withApp(
      {
        "app.chjs": app,
        "lib/side.chjs": `<script>export let ready = true;</script>`,
      },
      async (root) => {
        const graph = await buildModuleGraph(root, { entry: "app.chjs" });

        assert.ok(graph.moduleById("lib/side.chjs"));
        assert.deepEqual([...graph.root.deps], ["lib/side.chjs"]);
        assert.equal(graph.root.importMap.size, 0);
      }
    );
  });

  test("keeps two same-named components in different folders independent", async () => {
    const app =
      `<script>import A from "./a/card.chjs"; import B from "./b/card.chjs";</script>` +
      `<template><A /><B /></template>`;

    await withApp(
      {
        "app.chjs": app,
        "a/card.chjs": `<template><i>a</i></template>`,
        "b/card.chjs": `<template><i>b</i></template>`,
      },
      async (root) => {
        const graph = await buildModuleGraph(root, { entry: "app.chjs" });
        const a = graph.moduleById("a/card.chjs");
        const b = graph.moduleById("b/card.chjs");

        assert.ok(a && b);
        assert.notEqual(a.id, b.id);
        assert.notEqual(a.cssId, b.cssId);
        assert.deepEqual([...graph.root.deps].sort(), ["a/card.chjs", "b/card.chjs"]);
      }
    );
  });

  test("uses root-relative posix module ids", async () => {
    await withApp(
      {
        "app.chjs": `<script>import C from "./lib/sub/card.chjs";</script><template><C /></template>`,
        "lib/sub/card.chjs": `<template><span /></template>`,
      },
      async (root) => {
        const graph = await buildModuleGraph(root, { entry: "app.chjs" });

        assert.ok(graph.moduleById("lib/sub/card.chjs"));
        for (const id of graph.modules.keys()) {
          assert.equal(id.includes("\\"), false, id);
          assert.equal(path.isAbsolute(id), false, id);
        }
      }
    );
  });

  test("allows import cycles", async () => {
    const a =
      `<script>import B from "./b.chjs";</script>` +
      `<template><B /></template>`;
    const b =
      `<script>import A from "./a.chjs";</script>` +
      `<template><A /></template>`;

    await withApp({ "a.chjs": a, "b.chjs": b }, async (root) => {
      const graph = await buildModuleGraph(root, { entry: "a.chjs" });

      assert.equal(graph.modules.size, 2);
      assert.deepEqual([...graph.moduleById("a.chjs").deps], ["b.chjs"]);
      assert.deepEqual([...graph.moduleById("b.chjs").deps], ["a.chjs"]);
    });
  });

  test("supports script-only components", async () => {
    await withApp(
      {
        "app.chjs":
          `<script>import Helper from "./lib/helper.chjs"; export let value = Helper;</script>` +
          `<template><div /></template>`,
        "lib/helper.chjs": `<script>export let helper = true;</script>`,
      },
      async (root) => {
        const graph = await buildModuleGraph(root, { entry: "app.chjs" });
        const helper = graph.moduleById("lib/helper.chjs");

        assert.equal(helper.template, null);
        assert.equal(helper.script, "export let helper = true;");
        assert.equal(helper.styles, null);
      }
    );
  });

  test("normalizes configuration through normalizeConfig", async () => {
    await withApp({ "app.chjs": `<template><div /></template>` }, async (root) => {
      const defaults = await buildModuleGraph(root, { entry: "app.chjs" });
      assert.equal(defaults.config.treeShakeRuntime, true);

      const custom = await buildModuleGraph(root, {
        entry: "app.chjs",
        config: { treeShakeRuntime: false, hostKey: "x" },
      });
      assert.equal(custom.config.treeShakeRuntime, false);
      assert.equal(custom.config.hostKey, "x");
    });
  });
});

describe("module-graph — tag validation", () => {
  test("unknown tags report module id, line, and a suggestion", async () => {
    const app =
      `<script>import Greeting from "./lib/greeting.chjs";</script>\n` +
      `<template>\n` +
      `  <Greeting />\n` +
      `  <Greting />\n` +
      `</template>`;

    await withApp({ "app.chjs": app, "lib/greeting.chjs": greeting }, async (root) => {
      await assert.rejects(
        () => buildModuleGraph(root, { entry: "app.chjs" }),
        /Unknown component <Greting> in app\.chjs:4\. Did you forget to import it\? Did you mean <Greeting>\?/
      );
    });
  });

  test("unknown tags without a close match omit the suggestion", async () => {
    const app = `<template>\n  <Nope />\n</template>`;

    await withApp({ "app.chjs": app }, async (root) => {
      await assert.rejects(
        () => buildModuleGraph(root, { entry: "app.chjs" }),
        (error) => {
          assert.match(
            error.message,
            /Unknown component <Nope> in app\.chjs:2\. Did you forget to import it\?/
          );
          assert.doesNotMatch(error.message, /Did you mean/);
          return true;
        }
      );
    });
  });

  test("imported components resolve by lowercased local name", async () => {
    const app =
      `<script>import MyGreeting from "./lib/greeting.chjs";</script>` +
      `<template><mygreeting /></template>`;

    await withApp({ "app.chjs": app, "lib/greeting.chjs": greeting }, async (root) => {
      const graph = await buildModuleGraph(root, { entry: "app.chjs" });
      assert.deepEqual([...graph.root.deps], ["lib/greeting.chjs"]);
    });
  });

  test("hyphenated custom elements need no import", async () => {
    const app = `<template><my-widget /></template>`;
    await withApp({ "app.chjs": app }, async (root) => {
      const graph = await buildModuleGraph(root, { entry: "app.chjs" });
      assert.deepEqual([...graph.root.deps], []);
    });
  });
});

describe("module-graph — namespace imports", () => {
  test("resolves <Ns:Component> and <Ns:Subdir:Component>", async () => {
    const app =
      `<script>import * as Lib from "./lib/";</script>` +
      `<template><Lib:Card /><Lib:Sub:Thing /></template>`;

    await withApp(
      {
        "app.chjs": app,
        "lib/card.chjs": `<template><b>card</b></template>`,
        "lib/sub/thing.chjs": `<template><i>thing</i></template>`,
        "lib/unused.chjs": `<template><p>unused</p></template>`,
        "lib/format.js": `export const fmt = (x) => x;`,
      },
      async (root) => {
        const graph = await buildModuleGraph(root, { entry: "app.chjs" });
        const namespace = graph.root.namespaceMap.get("lib");

        assert.ok(namespace);
        assert.equal(namespace.components.get("card"), "lib/card.chjs");
        assert.equal(namespace.components.get("sub/thing"), "lib/sub/thing.chjs");
        assert.equal(namespace.moduleIds.size, 3);
        assert.deepEqual(
          [...graph.root.deps].sort(),
          ["lib/card.chjs", "lib/sub/thing.chjs", "lib/unused.chjs"]
        );
        assert.ok(graph.moduleById("lib/unused.chjs"), "namespace directories are walked eagerly");
        assert.equal(graph.moduleById("lib/format.js"), undefined);
      }
    );
  });

  test("unknown namespace components report a suggestion", async () => {
    const app =
      `<script>import * as Lib from "./lib/";</script>` +
      `<template><Lib:Crad /></template>`;

    await withApp(
      { "app.chjs": app, "lib/Card.chjs": `<template><b>card</b></template>` },
      async (root) => {
        await assert.rejects(
          () => buildModuleGraph(root, { entry: "app.chjs" }),
          /Unknown component <Lib:Crad> in app\.chjs:1\. Did you forget to import it\? Did you mean <Lib:Card>\?/
        );
      }
    );
  });

  test("a bare namespace tag is unknown", async () => {
    const app =
      `<script>import * as Lib from "./lib/";</script>` +
      `<template><Lib /></template>`;

    await withApp(
      { "app.chjs": app, "lib/card.chjs": `<template><b>card</b></template>` },
      async (root) => {
        await assert.rejects(
          () => buildModuleGraph(root, { entry: "app.chjs" }),
          /Unknown component <Lib> in app\.chjs:1/
        );
      }
    );
  });

  test("namespace imports must point to a directory", async () => {
    const app = `<script>import * as Lib from "./lib/";</script>`;

    await withApp({ "app.chjs": app, "lib": "not a directory" }, async (root) => {
      await assert.rejects(
        () => buildModuleGraph(root, { entry: "app.chjs" }),
        /Namespace import "\.\/lib\/" must point to a directory/
      );
    });
  });

  test("a .chjs file cannot be a namespace import", async () => {
    const app = `<script>import * as Lib from "./lib/card.chjs";</script>`;

    await withApp(
      { "app.chjs": app, "lib/card.chjs": `<template><b>card</b></template>` },
      async (root) => {
        await assert.rejects(
          () => buildModuleGraph(root, { entry: "app.chjs" }),
          /Namespace import "\.\/lib\/card\.chjs" must point to a directory/
        );
      }
    );
  });

  test("namespace prefixes cannot collide with imported locals", async () => {
    const app =
      `<script>import Lib from "./thing.chjs"; import * as Lib from "./lib/";</script>` +
      `<template><div /></template>`;

    await withApp(
      {
        "app.chjs": app,
        "thing.chjs": `<template><p>thing</p></template>`,
        "lib/card.chjs": `<template><b>card</b></template>`,
      },
      async (root) => {
        await assert.rejects(
          () => buildModuleGraph(root, { entry: "app.chjs" }),
          /Namespace prefix <Lib> collides with import <Lib> in app\.chjs/
        );
      }
    );
  });

  test("the same namespace prefix from different directories errors", async () => {
    const app =
      `<script>import * as Lib from "./a/"; import * as Lib from "./b/";</script>` +
      `<template><div /></template>`;

    await withApp(
      {
        "app.chjs": app,
        "a/card.chjs": `<template><b>a</b></template>`,
        "b/card.chjs": `<template><b>b</b></template>`,
      },
      async (root) => {
        await assert.rejects(
          () => buildModuleGraph(root, { entry: "app.chjs" }),
          /Namespace prefix <Lib> is imported from both "\.\/a\/" and "\.\/b\/" in app\.chjs/
        );
      }
    );
  });

  test("keeps non-.chjs namespace imports as host imports", async () => {
    const app =
      `<script>import * as fmt from "./lib/format.js";</script>` +
      `<template><div /></template>`;

    await withApp(
      { "app.chjs": app, "lib/format.js": `export const fmt = (x) => x;` },
      async (root) => {
        const graph = await buildModuleGraph(root, { entry: "app.chjs" });

        assert.equal(graph.root.imports.length, 1);
        assert.equal(graph.root.namespaceMap.size, 0);
        assert.equal(graph.moduleById("lib/format.js"), undefined);
      }
    );
  });
});
