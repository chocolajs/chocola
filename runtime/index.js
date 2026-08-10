const LBRACE_PH = "_%%CHOCOLA-LBRACE%%_";
const RBRACE_PH = "_%%CHOCOLA-RBRACE%%_";

const exprCache = new Map();

function compileExp(expr, useCtx) {
  expr = expr.replace(/_%%CHOCOLA-(?:AMP|LT|GT)\d+%%_/g, char =>
    char.includes("AMP") ? "&" : char.includes("LT") ? "<" : ">"
  );
  const key = useCtx ? "ctx:" + expr : "raw:" + expr;
  let fn = exprCache.get(key);
  if (!fn) {
    fn = useCtx
      ? new Function("ctx", "with(ctx) { return (" + expr + "); }")
      : new Function('"use strict"; return (' + expr + ")");
    exprCache.set(key, fn);
  }
  return fn;
}

function interpolateNode(root, ctx) {
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    if (node.nodeType === 3) {
      const text = node.textContent
        .replace(new RegExp(LBRACE_PH, "g"), "{")
        .replace(new RegExp(RBRACE_PH, "g"), "}");
      node.textContent = text.replace(/\{([^}]+)\}/g, (_, expr) => {
        try {
          return String(compileExp(expr, true)(ctx));
        } catch {
          return "";
        }
      });
    } else {
      for (let i = node.childNodes.length - 1; i >= 0; i--) {
        stack.push(node.childNodes[i]);
      }
    }
  }
}

function applyDirectiveToEl(child, ctx, chain, hasIf, hasMountIf, hasElif, hasElse) {
  if (hasIf) {
    const expr = child.getAttribute("if").slice(1, -1);
    chain.active = true;
    if (compileExp(expr, true)(ctx)) {
      chain.rendered = true;
    } else {
      child.style.display = "none";
      chain.rendered = false;
    }
    child.removeAttribute("if");
  } else if (hasMountIf) {
    const expr = child.getAttribute("mount:if").slice(1, -1);
    chain.active = true;
    if (compileExp(expr, true)(ctx)) {
      chain.rendered = true;
    } else {
      child.remove();
      chain.rendered = false;
    }
    child.removeAttribute("mount:if");
  } else if (hasElif) {
    const expr = child.getAttribute("elif").slice(1, -1);
    if (compileExp(expr, true)(ctx)) {
      chain.rendered = true;
    } else {
      child.remove();
    }
    child.removeAttribute("elif");
  } else if (hasElse) {
    chain.rendered = true;
    chain.active = false;
    child.removeAttribute("else");
  } else {
    chain.active = false;
    chain.rendered = false;
  }
}

function interpolateAttributes(element, ctx) {
  for (const el of [element, ...element.querySelectorAll("*")]) {
    for (const attr of [...el.attributes]) {
      const val = attr.value;
      if (!val.includes("{") && !val.includes(LBRACE_PH)) continue;
      const raw = val
        .replace(new RegExp(LBRACE_PH, "g"), "{")
        .replace(new RegExp(RBRACE_PH, "g"), "}");
      attr.value = raw.replace(/\{([^}]+)\}/g, (_, expr) => {
        try {
          return String(compileExp(expr, true)(ctx));
        } catch {
          return "";
        }
      });
    }
  }
}

function processDirectives(element, ctx, chain) {
  for (const child of [...element.children]) {
    const hasIf = child.hasAttribute("if");
    const hasMountIf = child.hasAttribute("mount:if");
    const hasElif = child.hasAttribute("elif");
    const hasElse = child.hasAttribute("else");

    if ((hasElif || hasElse) && chain.rendered) {
      child.remove();
      if (hasElse) chain.active = false;
      continue;
    }

    applyDirectiveToEl(child, ctx, chain, hasIf, hasMountIf, hasElif, hasElse);

    if (child.parentNode) {
      processDirectives(child, ctx, chain);
    }
  }
}

function processSlots(el, projected) {
  const slots = el.querySelectorAll("slot");
  for (const slot of slots) {
    const clone = projected.map(c => c.cloneNode(true));
    slot.replaceWith(...clone);
  }
}

let bindCounter = 0;

function processBindings(el) {
  const bindings = [];
  for (const attr of [...el.attributes]) {
    if (attr.name.startsWith("bind:")) {
      const prop = attr.name.slice(5);
      const varName = attr.value;
      const bindId = "b" + (bindCounter++);
      el.setAttribute("data-chbind-" + bindId, "");
      bindings.push({ prop, varName, bindId });
      el.removeAttribute(attr.name);
    }
  }
  return bindings;
}

function resolveBindings(el) {
  const ids = [];
  for (const attr of [...el.attributes]) {
    const match = attr.name.match(/^data-chbind-(b\d+)$/);
    if (match) {
      ids.push(match[1]);
      el.removeAttribute(attr.name);
    }
  }
  return ids;
}

function collectBindings(root) {
  const bindingDefs = [];
  const idToEl = {};

  for (const el of [root, ...root.querySelectorAll("*")]) {
    bindingDefs.push(...processBindings(el));
    for (const id of resolveBindings(el)) {
      idToEl[id] = el;
    }
  }
  return { bindingDefs, idToEl };
}

class ChocolaComponent {
  #template;
  #hash;
  #runtime;
  #defaultProps;
  #bakedComponent;
  #ctx;
  #eventListeners = [];
  #children;
  #childComponents;

  constructor(config = {}) {
    this.#template = config.template || "";
    this.#hash = config.hash || "";
    this.#runtime = config.runtime || null;
    this.#defaultProps = config.props || {};
    this.#childComponents = config.children || [];
  }

  #collectListeners(root, fn) {
    const allEls = [root, ...root.querySelectorAll("*")];
    const patches = [];

    for (const el of allEls) {
      const original = el.addEventListener;
      el.addEventListener = (event, handler, options) => {
        this.#eventListeners.push({ el, event, handler, options });
        original.call(el, event, handler, options);
      };
      patches.push({ el, original });
    }

    try {
      fn(root, this.#ctx);
    } finally {
      for (const { el, original } of patches) {
        el.addEventListener = original;
      }
    }
  }

  #init(ctx) {
    const mergedCtx = { ...this.#defaultProps, ...ctx };

    const container = document.createElement("template");
    container.innerHTML = this.#template;
    const fragment = container.content;
    const root = fragment.firstElementChild;

    if (!root) {
      console.error(`${this.#hash}: component template must have a single root element`);
      return null;
    }

    processSlots(root, this.#children || []);
    processDirectives(root, mergedCtx, { active: false, rendered: false });
    interpolateAttributes(root, mergedCtx);
    interpolateNode(root, mergedCtx);
    root.classList.add(this.#hash);

    const { bindingDefs, idToEl } = collectBindings(root);
    this.#ctx = { ...mergedCtx };
    for (const { prop, varName, bindId } of bindingDefs) {
      const el = idToEl[bindId];
      if (el) {
        this.#ctx[varName] = prop === "self" ? el : el[prop];
      }
    }

    if (this.#runtime) {
      this.#collectListeners(root, (self, ctx) => {
        this.#runtime(self, ctx);
      });
    }

    this.#bakedComponent = root;
    container.remove();
    return root;
  }

  #childInstances = [];

  #mountChildren(root) {
    for (const { tag, compClass } of this.#childComponents) {
      const els = root.querySelectorAll(tag);
      for (const el of els) {
        const props = {};
        for (const attr of [...el.attributes]) {
          if (attr.name.startsWith("data-ch") || attr.name === "if" || attr.name === "mount:if" || attr.name === "elif" || attr.name === "else") continue;
          props[attr.name] = attr.value;
        }
        const instance = new compClass();
        instance.mount(el.parentNode, props);
        this.#childInstances.push(instance);
        el.remove();
      }
    }
  }

  mount(target, ctx = {}) {
    if (target.nodeType !== 1) {
      console.error(`${this.#hash}: mount target is not a valid DOM node`);
      return;
    }
    this.#children = [...target.children];
    this.#init(ctx);
    if (this.#bakedComponent) {
      target.appendChild(this.#bakedComponent);
      this.#mountChildren(this.#bakedComponent);
    }
  }

  remove() {
    for (const { el, event, handler, options } of this.#eventListeners) {
      el.removeEventListener(event, handler, options);
    }
    this.#eventListeners = [];
    for (const child of this.#childInstances) {
      child.remove();
    }
    this.#childInstances = [];
    if (this.#bakedComponent) {
      this.#bakedComponent.remove();
      this.#bakedComponent = null;
    }
  }

  update(ctx = {}) {
    const mergedCtx = { ...this.#defaultProps, ...ctx };
    const parent = this.#bakedComponent?.parentNode;
    parent && this.remove();
    this.#init(mergedCtx);
    if (parent && this.#bakedComponent) {
      parent.appendChild(this.#bakedComponent);
      this.#mountChildren(this.#bakedComponent);
    }
  }
}

export { ChocolaComponent };
