import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";

import { ChocolaComponent } from "../runtime/index.js";

let document;

before(() => {
  const parsed = parseHTML("<html><body></body></html>");
  document = parsed.document;
  globalThis.document = document;
  globalThis.window = parsed.window;
});

function mountHost() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return host;
}

describe("runtime — ChocolaComponent", () => {
  test("mount renders template with merged props and hash class", () => {
    const host = mountHost();
    const comp = new ChocolaComponent({
      template: `<div><p>Hello {name}!</p></div>`,
      hash: "testhash",
      props: { name: "World" },
    });
    comp.mount(host, { name: "Ada" });
    const root = host.firstElementChild;
    assert.ok(root);
    assert.ok(root.textContent.includes("Hello Ada!"));
    assert.ok(root.classList.contains("testhash"));
    comp.remove();
    host.remove();
  });

  test("default props apply when ctx omits them", () => {
    const host = mountHost();
    const comp = new ChocolaComponent({
      template: `<div><p>{n}</p></div>`,
      hash: "h2",
      props: { n: 7 },
    });
    comp.mount(host, {});
    assert.ok(host.textContent.includes("7"));
    comp.remove();
    host.remove();
  });

  test("update re-renders in place", () => {
    const host = mountHost();
    const comp = new ChocolaComponent({
      template: `<div><p>{n}</p></div>`,
      hash: "h3",
      props: { n: 1 },
    });
    comp.mount(host, {});
    comp.update({ n: 2 });
    assert.ok(host.textContent.includes("2"));
    assert.equal(host.children.length, 1);
    comp.remove();
    host.remove();
  });

  test("remove detaches and cleans up listeners", () => {
    const host = mountHost();
    let clicks = 0;
    const comp = new ChocolaComponent({
      template: `<div><button>go</button></div>`,
      hash: "h4",
      runtime(self) {
        self.querySelector("button").addEventListener("click", () => clicks++);
      },
    });
    comp.mount(host, {});
    host.querySelector("button").click();
    assert.equal(clicks, 1);
    comp.remove();
    assert.equal(host.children.length, 0);
    host.remove();
  });

  test("bind:self wires the element into runtime ctx", () => {
    const host = mountHost();
    let seen = null;
    const comp = new ChocolaComponent({
      template: `<div><button bind:self="btn">go</button></div>`,
      hash: "h5",
      runtime(self, ctx) {
        seen = ctx.btn;
      },
    });
    comp.mount(host, {});
    assert.equal(seen, host.querySelector("button"));
    comp.remove();
    host.remove();
  });

  test("if hides, mount:if removes", () => {
    const host = mountHost();
    const comp = new ChocolaComponent({
      template: `<div><p if="{show}">a</p><p mount:if="{gone}">b</p></div>`,
      hash: "h6",
    });
    comp.mount(host, { show: false, gone: false });
    const ps = host.querySelectorAll("p");
    assert.equal(ps.length, 1, "mount:if=false must remove the node");
    assert.equal(ps[0].style.display, "none");
    comp.remove();
    host.remove();
  });

  test("slot projects host children", () => {
    const host = mountHost();
    host.innerHTML = "<span>projected</span>";
    const comp = new ChocolaComponent({
      template: `<div class="card"><slot></slot></div>`,
      hash: "h7",
    });
    comp.mount(host, {});
    assert.ok(host.textContent.includes("projected"));
    comp.remove();
    host.remove();
  });

  test("non-element mount target errors gracefully; template without root errors", () => {
    const errors = [];
    const orig = console.error;
    console.error = (...args) => errors.push(args.join(" "));
    try {
      const host = mountHost();
      const textNode = document.createTextNode("text");
      host.appendChild(textNode);
      const comp = new ChocolaComponent({ template: `<div>x</div>`, hash: "h8" });
      assert.doesNotThrow(() => comp.mount(textNode));
      assert.equal(host.querySelector("div"), null, "nothing should mount on a non-element");
      const empty = new ChocolaComponent({ template: ``, hash: "h9" });
      assert.doesNotThrow(() => empty.mount(host, {}));
      host.remove();
    } finally {
      console.error = orig;
    }
    assert.ok(errors.length >= 2, `expected console.error calls, got ${errors.length}`);
  });
});
