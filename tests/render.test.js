import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { buildModuleGraph } from "../compiler/module-graph.js";
import { render } from "../compiler/render.js";
import { deterministicHash } from "../compiler/utils.js";
import { FIXTURE_BASIC, mkTmpApp, cleanupTmp } from "./helpers.js";

async function renderFixture(ctx = {}) {
  const graph = await buildModuleGraph(FIXTURE_BASIC, { entry: "app.chjs" });
  return render(graph, ctx);
}

async function withApp(files, fn) {
  const { tmpParent, tmpRoot } = await mkTmpApp(files);
  try {
    return await fn(tmpRoot);
  } finally {
    await cleanupTmp(tmpParent);
  }
}

async function renderApp(files, ctx = {}) {
  return withApp(files, async (root) => {
    const graph = await buildModuleGraph(root, { entry: "app.chjs" });
    return render(graph, ctx);
  });
}

describe("render — result shape and fragment output", () => {
  test("returns exactly html, styles, runtime, and hashMap", async () => {
    const result = await renderFixture({ title: "Ctx" });

    assert.deepEqual(Object.keys(result).sort(), [
      "hashMap",
      "html",
      "runtime",
      "styles",
    ]);
    assert.equal(typeof result.html, "string");
    assert.equal(typeof result.styles, "string");
    assert.ok(Array.isArray(result.runtime));
    assert.equal(typeof result.hashMap, "object");
  });

  test("html is a fragment, not a document", async () => {
    const { html } = await renderFixture();

    assert.match(html, /<section/);
    assert.doesNotMatch(html, /<html[\s>]/i);
    assert.doesNotMatch(html, /<head[\s>]/i);
    assert.doesNotMatch(html, /<body[\s>]/i);
    assert.doesNotMatch(html, /<app[\s>]/i);
  });

  test("interpolates props, projects slots, and renders nested components", async () => {
    const { html } = await renderFixture({ title: "Context title" });

    assert.match(html, /Context title/);
    assert.match(html, /Hello World!/);
    assert.match(html, /slot content/);
    assert.match(html, /class="counter/);
    assert.match(html, /class="action/);
  });

  test("applies conditionals before interpolation", async () => {
    const result = await renderApp(
      {
        "app.chjs":
          `<script>export let show = true;</script>` +
          `<template><div><p if="{show}">yes</p><p mount:if="{gone}">no</p></div></template>`,
      },
      { show: true, gone: false }
    );

    assert.match(result.html, /yes/);
    assert.doesNotMatch(result.html, /no/);
  });
});

describe("render — scoped styles and hashMap", () => {
  test("keys hashMap by root-relative module id", async () => {
    const { hashMap } = await renderFixture();

    assert.equal(hashMap["app.chjs"], deterministicHash("app.chjs", 8));
    assert.equal(
      hashMap["lib/card.chjs"],
      deterministicHash("lib/card.chjs", 8)
    );
    assert.equal(hashMap["lib/unused.chjs"], undefined);
    assert.deepEqual(Object.keys(hashMap).sort(), [
      "app.chjs",
      "lib/action.chjs",
      "lib/card.chjs",
      "lib/counter.chjs",
      "lib/greeting.chjs",
    ]);
  });

  test("scopes css with each module id and does not leak attributes", async () => {
    const { html, styles, hashMap } = await renderFixture();

    const appHash = hashMap["app.chjs"];
    const cardHash = hashMap["lib/card.chjs"];
    const actionHash = hashMap["lib/action.chjs"];

    assert.match(styles, new RegExp(`\\.app\\[data-sc-${appHash}\\]`));
    assert.match(styles, new RegExp(`\\.card\\[data-sc-${cardHash}\\]`));
    assert.match(styles, new RegExp(`\\.action\\[data-sc-${actionHash}\\]`));

    assert.match(html, new RegExp(`data-sc-${appHash}`));
    assert.match(html, new RegExp(`data-sc-${cardHash}`));
    assert.match(html, new RegExp(`data-sc-${actionHash}`));
  });

  test("two components with the same basename get distinct ids and classes", async () => {
    const result = await renderApp({
      "app.chjs":
        `<script>import A from "./a/card.chjs"; import B from "./b/card.chjs";</script>` +
        `<template><div><A /><B /></div></template>`,
      "a/card.chjs": `<template><i class="a">A</i></template>`,
      "b/card.chjs": `<template><i class="b">B</i></template>`,
    });

    const aHash = result.hashMap["a/card.chjs"];
    const bHash = result.hashMap["b/card.chjs"];
    assert.ok(aHash && bHash);
    assert.notEqual(aHash, bHash);
    assert.match(result.html, /class="a/);
    assert.match(result.html, /class="b/);

    const aChunk = result.runtime.find((file) =>
      file.content.includes("class Card_")
    );
    const cardClasses = result.runtime
      .flatMap((file) => [...file.content.matchAll(/class (Card_[a-z0-9]+) /g)])
      .map((match) => match[1]);
    assert.equal(new Set(cardClasses).size, 2);
    assert.ok(aChunk);
  });
});

describe("render — runtime descriptors", () => {
  test("emits the base chunk first and the DOM chunk last", async () => {
    const { runtime } = await renderFixture();

    assert.ok(runtime.length >= 2);
    const first = runtime[0];
    const last = runtime[runtime.length - 1];

    assert.match(first.name, /^run-[a-z0-9]{6}\.js$/);
    assert.match(first.content, /export \{ ChocolaComponent \};/);
    assert.match(last.content, /DOMContentLoaded/);
    assert.match(last.content, /document\.querySelector\('\[chid="/);
  });

  test("preserves non-.chjs imports and removes .chjs import lines", async () => {
    const { runtime } = await renderFixture();
    const counterChunk = runtime.find((file) =>
      file.content.includes("class Counter_")
    );

    assert.ok(counterChunk);
    assert.match(counterChunk.content, /import \{ fmt \} from "\.\/format\.js";/);
    assert.doesNotMatch(counterChunk.content, /counter\.chjs/);
    assert.match(counterChunk.content, /export function r_/);
  });

  test("aliases imported child classes per local name", async () => {
    const { runtime } = await renderFixture();
    const appChunk = runtime.find((file) => file.content.includes("class App_"));

    assert.ok(appChunk);
    assert.match(appChunk.content, /import \{ Greeting_[a-z0-9]+ as Greeting \}/);
    assert.match(appChunk.content, /import \{ Counter_[a-z0-9]+ as Counter \}/);
    assert.match(appChunk.content, /import \{ Card_[a-z0-9]+ as Card \}/);
    assert.doesNotMatch(appChunk.content, /\.chjs/);
  });

  test("exports a runtime function derived from the module id", async () => {
    const graph = await buildModuleGraph(FIXTURE_BASIC, { entry: "app.chjs" });
    const result = await render(graph);
    const counter = graph.moduleById("lib/counter.chjs");
    const chunk = result.runtime.find((file) =>
      file.content.includes(`export function ${counter.fnId}`)
    );

    assert.ok(chunk);
    assert.equal(counter.fnId, "r_" + deterministicHash("lib/counter.chjs", 8));
  });

  test("emits base runtime even for a fully static root", async () => {
    const result = await renderApp({
      "app.chjs": `<template><div>static</div></template>`,
    });

    assert.match(result.runtime[0].content, /export \{ ChocolaComponent \};/);
    assert.equal(
      result.runtime.some((file) => file.content.includes("DOMContentLoaded")),
      false,
      "a static root has no hydration chunk"
    );
    assert.equal(result.html.includes("static"), true);
  });

  test("root $runtime attaches chid and emits a hydration call", async () => {
    const result = await renderApp({
      "app.chjs":
        `<script>export let n = 1; function $runtime() { self.dataset.n = n; }</script>` +
        `<template><main class="root">{n}</main></template>`,
    });

    assert.match(result.html, /<main[^>]*chid="chid-[a-z0-9]+"/);
    assert.match(result.html, /<main[^>]*class="root/);

    const dom = result.runtime.find((file) =>
      file.content.includes("DOMContentLoaded")
    );
    assert.ok(dom);
    assert.match(dom.content, /import \{ r_[a-z0-9]+ as __r0 \}/);
    assert.match(dom.content, /document\.querySelector\('\[chid="chid-/);
  });

  test("each instance gets its own chid and hydration call", async () => {
    const result = await renderApp({
      "app.chjs":
        `<script>import Counter from "./counter.chjs";</script>` +
        `<template><div><Counter start="1" /><Counter start="2" /></div></template>`,
      "counter.chjs":
        `<script>export let start = 0; function $runtime() { self.dataset.start = start; }</script>` +
        `<template><span>{start}</span></template>`,
    });

    const chids = [...result.html.matchAll(/chid="(chid-[a-z0-9]+)"/g)].map(
      (match) => match[1]
    );
    assert.equal(chids.length, 2);
    assert.equal(new Set(chids).size, 2);

    const dom = result.runtime.find((file) =>
      file.content.includes("DOMContentLoaded")
    );
    assert.ok(dom);
    for (const chid of chids) {
      assert.match(dom.content, new RegExp(`querySelector\\('\\[chid="${chid}"\\]`));
    }
    assert.equal([...dom.content.matchAll(/__r0\(/g)].length, 2);
  });
});

describe("render — script-only components", () => {
  test("a script-only root renders an empty fragment", async () => {
    const result = await renderApp({
      "app.chjs": `<script>export let x = 1;</script>`,
    });

    assert.equal(result.html, "");
    assert.deepEqual(result.hashMap, {});
    assert.equal(result.runtime.length, 1, "only the base chunk is emitted");
  });

  test("a nested script-only component is removed and emits no chid", async () => {
    const result = await renderApp({
      "app.chjs":
        `<script>import Helper from "./lib/helper.chjs";</script>` +
        `<template><div><Helper /><span>after</span></div></template>`,
      "lib/helper.chjs": `<script>export let helper = true;</script>`,
    });

    assert.doesNotMatch(result.html, /<helper/i);
    assert.match(result.html, /after/);
    assert.doesNotMatch(result.html, /chid-/);
  });
});

describe("render — purity and concurrency", () => {
  test("repeated renders produce identical results", async () => {
    const first = await renderFixture({ title: "Same" });
    const second = await renderFixture({ title: "Same" });

    assert.deepEqual(second, first);
  });

  test("concurrent renders with different contexts do not cross-contaminate", async () => {
    const [a, b] = await Promise.all([
      renderFixture({ title: "One" }),
      renderFixture({ title: "Two" }),
    ]);

    assert.match(a.html, /One/);
    assert.doesNotMatch(a.html, /Two/);
    assert.match(b.html, /Two/);
    assert.doesNotMatch(b.html, /One/);
  });

  test("render writes nothing to the project", async () => {
    const { tmpParent, tmpRoot } = await mkTmpApp({
      "app.chjs": `<template><div>pure</div></template>`,
    });

    try {
      const before = await snapshot(tmpRoot);
      const graph = await buildModuleGraph(tmpRoot, { entry: "app.chjs" });
      await render(graph);
      const after = await snapshot(tmpRoot);
      assert.deepEqual(after, before);
    } finally {
      await cleanupTmp(tmpParent);
    }
  });
});

describe("render — cycles", () => {
  test("stops recursion by module id and terminates", async () => {
    const result = await renderApp({
      "app.chjs":
        `<script>import B from "./b.chjs";</script>` +
        `<template><div><B /></div></template>`,
      "b.chjs":
        `<script>import A from "./app.chjs";</script>` +
        `<template><section><A /></section></template>`,
    });

    assert.match(result.html, /<section/);
    assert.match(result.html, /<a/);
  });
});

async function snapshot(dir) {
  const { promises: fs } = await import("fs");
  const path = await import("path");
  const entries = [];

  async function walk(current) {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        entries.push(path.relative(dir, full) + "/");
        await walk(full);
      } else {
        entries.push(path.relative(dir, full));
      }
    }
  }

  await walk(dir);
  return entries.sort();
}
