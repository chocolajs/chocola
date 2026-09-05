const ansi = {
  bold: "\x1b[1m",
  underline: "\x1b[4m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[36m",
  dim: "\x1b[90m"
};

const reset = "\x1b[0m";

function hexToAnsi(h) {
  const r = parseInt(h.slice(1, 3), 16);
  const g = parseInt(h.slice(3, 5), 16);
  const b = parseInt(h.slice(5, 7), 16);
  return `\x1b[38;2;${r};${g};${b}m`;
}

function makeChalk(stack) {
  const fn = (s) => {
    if (stack.length === 0) return s;
    return stack.map(n => ansi[n] || hexToAnsi(n)).join("") + s + reset;
  };
  return new Proxy(fn, {
    get(_, prop) {
      if (prop === "hex") return (h) => makeChalk([...stack, h]);
      return makeChalk([...stack, prop]);
    },
  });
}

const chalk = makeChalk([]);
export default chalk;
