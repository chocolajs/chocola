import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { parseHTML } from "linkedom";

import {
  getComponents,
  getSrcIndex,
  processStylesheet,
  processIcons,
  processScript,
  copyStaticDir,
} from "../compiler/pipeline.js";
import {
  createDOM,
  validateAppContainer,
  getAppElements,
  serializeDOM,
  getAssetLinks,
  getScriptElements,
  appendStylesheetLink,
  appendRuntimeScript,
} from "../compiler/dom-processor.js";
import { generateRuntimeScript } from "../compiler/runtime-generator.js";
import { readMyFile, checkFile } from "../compiler/fs.js";
import { mkTmpFromFixture, cleanupTmp } from "./helpers.js";

let tmpParent;
let tmpRoot;

before(async () => {
  ({ tmpParent, tmpRoot } = await mkTmpFromFixture("basic"));
});

after(async () => {
  await cleanupTmp(tmpParent);
});

function freshOut() {
  return { files: [], copies: [], ids: [], outDir: path.join(tmpRoot, "dist") };
}

describe("pipeline — discovery", () => {
  test("getComponents keys lowercase, tracks originals and empties", async () => {
    const libDir = path.join(tmpRoot, "src", "lib");
    await fs.writeFile(path.join(libDir, "Empty.html"), "   ");
    await fs.writeFile(path.join(libDir, "MixedCase.html"), "<template><div>x</div></template>");
    try {
      const { loadedComponents, originalNames, componentsLib, emptyComps } = await getComponents(libDir);
      assert.ok(loadedComponents.has("mixedcase.html"));
      assert.equal(originalNames.get("mixedcase.html"), "MixedCase.html");
      assert.ok(componentsLib.includes("MixedCase.html"));
      assert.ok(emptyComps.includes("Empty.html"));
    } finally {
      await fs.rm(path.join(libDir, "Empty.html"), { force: true });
      await fs.rm(path.join(libDir, "MixedCase.html"), { force: true });
    }
  });

  test("getComponents on missing dir throws", async () => {
    await assert.rejects(() => getComponents(path.join(tmpRoot, "nope")), /Failed to load components/);
  });

  test("getSrcIndex returns page source; missing index yields undefined", async () => {
    const found = await getSrcIndex(path.join(tmpRoot, "src"));
    assert.ok(found.srcHtmlFile.includes("<app>"));
    assert.ok(found.srcPath.endsWith("index.html"));

    const empty = await fs.mkdtemp(path.join(os.tmpdir(), "chocola-noindex-"));
    try {
      assert.equal(await getSrcIndex(empty), undefined);
    } finally {
      await fs.rm(empty, { recursive: true, force: true });
    }
  });
});

describe("pipeline — assets", () => {
  test("processStylesheet hashes name and skips external urls", async () => {
    const out = freshOut();
    const doc = parseHTML('<html><head><link rel="stylesheet" href="styles.css"/></head></html>').document;
    const link = doc.querySelector("link");
    await processStylesheet(link, tmpRoot, "src", out);
    assert.match(out.files[0].path, /^css-[a-z0-9]+\.css$/);
    assert.equal(link.getAttribute("href"), "./" + out.files[0].path);

    const ext = parseHTML('<html><head><link rel="stylesheet" href="https://x/y.css"/></head></html>').document;
    await processStylesheet(ext.querySelector("link"), tmpRoot, "src", out);
    assert.equal(out.files.length, 1, "external stylesheet must be skipped");
  });

  test("processStylesheet disambiguates name collisions", async () => {
    const out = freshOut();
    const mk = () => parseHTML('<html><head><link rel="stylesheet" href="styles.css"/></head></html>').document.querySelector("link");
    await processStylesheet(mk(), tmpRoot, "src", out);
    await processStylesheet(mk(), tmpRoot, "src", out);
    assert.notEqual(out.files[0].path, out.files[1].path);
  });

  test("processIcons stages a copy op", async () => {
    const out = freshOut();
    const doc = parseHTML('<html><head><link rel="icon" href="favicon.ico"/></head></html>').document;
    await processIcons(doc.querySelector("link"), tmpRoot, "src", out);
    assert.equal(out.copies.length, 1);
    assert.ok(out.copies[0].to.endsWith("favicon.ico"));
  });

  test("processScript hashes name and rewrites src", async () => {
    const out = freshOut();
    const doc = parseHTML('<html><head><script src="app.js"></script></head></html>').document;
    await processScript(doc, doc.querySelector("script"), tmpRoot, "src", out);
    assert.match(out.files[0].path, /^js-[a-z0-9]+\.js$/);
    assert.equal(doc.querySelector("script").getAttribute("src"), "./" + out.files[0].path);
  });

  test("copyStaticDir stages recursive copy; absent static is a no-op", async () => {
    const out = freshOut();
    await copyStaticDir(path.join(tmpRoot, "src"), out);
    assert.equal(out.copies.length, 1);
    assert.equal(out.copies[0].recursive, true);

    const empty = await fs.mkdtemp(path.join(os.tmpdir(), "chocola-nostatic-"));
    try {
      const out2 = freshOut();
      await copyStaticDir(empty, out2);
      assert.equal(out2.copies.length, 0);
    } finally {
      await fs.rm(empty, { recursive: true, force: true });
    }
  });
});

describe("pipeline — dom-processor", () => {
  test("createDOM protects braces; serializeDOM restores them", async () => {
    const dom = createDOM("<html><body><app><p>{title}</p></app></body></html>");
    assert.ok(validateAppContainer(dom.document));
    assert.equal(getAppElements(dom.document.querySelector("app")).length, 1);
    const html = await serializeDOM(dom);
    assert.ok(html.includes("{title}"), `braces not restored: ${html.slice(0, 120)}`);
  });

  test("validateAppContainer throws without <app>", () => {
    const dom = createDOM("<html><body><p>nope</p></body></html>");
    assert.throws(() => validateAppContainer(dom.document), /<app>/);
  });

  test("asset links, script elements, append helpers", () => {
    const dom = createDOM(
      '<html><head><link rel="stylesheet" href="a.css"/><link rel="icon" href="f.ico"/></head><body><script src="a.js"></script></body></html>'
    );
    const { stylesheets, icons } = getAssetLinks(dom.document);
    assert.equal(stylesheets.length, 1);
    assert.equal(icons.length, 1);
    assert.equal(getScriptElements(dom.document).length, 1);
    appendStylesheetLink(dom.document, "sc-abc.css");
    appendRuntimeScript(dom.document, "run-abc.js");
    assert.ok(dom.document.querySelector('link[href="./sc-abc.css"]'));
    assert.ok(dom.document.querySelector('script[src="./run-abc.js"]'));
  });
});

describe("pipeline — runtime-generator and fs", () => {
  test("generateRuntimeScript emits up to 3 deterministic files", () => {
    assert.deepEqual(generateRuntimeScript("", "", ""), []);
    const base = generateRuntimeScript("", "class A {}", "");
    assert.equal(base.length, 1);
    assert.match(base[0].path, /^run-[a-z]+\.js$/);
    const again = generateRuntimeScript("", "class A {}", "");
    assert.equal(again[0].path, base[0].path, "names must be deterministic");

    const full = generateRuntimeScript("r_abc(el);", "class A {}", "class B extends A {}");
    assert.equal(full.length, 3);
    assert.ok(full[2].content.includes("DOMContentLoaded"));
  });

  test("readMyFile reads; checkFile probes existence", async () => {
    const p = path.join(tmpRoot, "src", "app.js");
    assert.ok((await readMyFile(p)).length >= 0);
    assert.equal(await checkFile(p), true);
    assert.equal(await checkFile(path.join(tmpRoot, "missing.txt")), false);
    await assert.rejects(() => readMyFile(path.join(tmpRoot, "missing.txt")), /trying to read the file/);
  });
});
