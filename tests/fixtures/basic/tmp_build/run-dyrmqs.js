document.addEventListener("DOMContentLoaded", () => {function r_njlqxnce(self, ctx) {
let count = ctx.count??(0);

let span = self.querySelector('[data-chbind-b0]');
let btn = self.querySelector('[data-chbind-b1]');

    btn.addEventListener("click", () => {
      count++;
      span.textContent = count;
    });
  }
r_njlqxnce(document.querySelector('[chid="chid-qludsnrr"]'), {"start":"5","count":0});
function $runtime(self, ctx) {

    if (self.onclick) {
      self.onclick = null;
    }
  }
r_qlqqqipe(document.querySelector('[chid="chid-dicuzjor"]'), {"action":null});})