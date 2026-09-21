class Counter extends ChocolaComponent {
  constructor() {
    super({
      template: `
  <div class="counter">
    <span bind:self="span">{count}</span>
    <button bind:self="btn">+</button>
  </div>
`,
      hash: "njlqxnce",
      props: { "count": 0 },
      runtime: function(self, ctx) {
let count = ctx.count??(0);
let span = ctx.span;
let btn = ctx.btn;

    btn.addEventListener("click", () => {
      count++;
      span.textContent = count;
    });
  }
    });
  }
}

class Action extends ChocolaComponent {
  constructor() {
    super({
      template: `
  <button class="action" bind:onclick="action">
    <slot></slot>
  </button>
`,
      hash: "qlqqqipe",
      props: {},
      runtime: function $runtime(self, ctx) {

    if (self.onclick) {
      self.onclick = null;
    }
  }
    });
  }
}