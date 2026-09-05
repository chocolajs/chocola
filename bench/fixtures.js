import path from "path";
import { promises as fs } from "fs";
import os from "os";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const BASIC_FIXTURE = path.join(__dirname, "..", "tests", "fixtures", "basic");

export function writeBasicApp(root) {
  return fs.cp(BASIC_FIXTURE, root, { recursive: true });
}

export async function makeTempApp(seed) {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "chocola-bench-"));
  const root = path.join(parent, "app");
  await seed(root);
  return {
    root,
    async cleanup() {
      await fs.rm(parent, { recursive: true, force: true });
    },
  };
}

function componentSource(name, i) {
  return [
    "<template>",
    `  <div class="${name}">`,
    `    <span>{m${i}}</span>`,
    "  </div>",
    "</template>",
    "<script>",
    `  export let m${i} = "m${i}";`,
    "</script>",
    `<style>`,
    `  .${name} { color: #000; }`,
    `</style>`,
    "",
  ].join("\n");
}

function nestedComponentSource(name, i, depth) {
  const hasChild = i < depth;
  const body = [
    `  <div class="${name}">`,
    `    <span>depth ${i}</span>`,
    hasChild ? `    <d${i + 1}></d${i + 1}>` : "",
    "  </div>",
  ]
    .filter(Boolean)
    .join("\n");
  return `<template>\n${body}\n</template>\n<script>\n  export let v${i} = ${i};\n</script>\n`;
}

export async function makeSyntheticApp({ components = 0, depth = 0, pageSizeKb = 0 }) {
  return makeTempApp(async (root) => {
    const libDir = path.join(root, "src", "lib");
    await fs.mkdir(libDir, { recursive: true });
    await fs.writeFile(
      path.join(root, "chocola.config.json"),
      JSON.stringify({ bundle: { srcDir: "src", outDir: "dist" } }, null, 2)
    );

    const used = [];

    if (components > 0) {
      for (let i = 0; i < components; i++) {
        await fs.writeFile(path.join(libDir, `c${i}.html`), componentSource(`c${i}`, i));
        used.push(`<c${i}></c${i}>`);
      }
    }

    if (depth > 0) {
      for (let i = 0; i <= depth; i++) {
        const name = `d${i}`;
        await fs.writeFile(
          path.join(libDir, `${name}.html`),
          nestedComponentSource(name, i, depth)
        );
      }
      used.push("<d0></d0>");
    }

    let filler = "";
    if (pageSizeKb > 0) {
      const block = "<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Padding text for large page source.</p>";
      const reps = Math.max(1, Math.ceil((pageSizeKb * 1024) / block.length));
      filler =
        "\n    " +
        Array.from({ length: reps }, (_, i) => `<div class="pad${i % 10}">${block}</div>`).join("\n    ");
    }

    const body = used.length ? used.join("\n    ") : "<div>empty</div>";
    const index = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Bench</title>
</head>
<body>
  <app>
    ${body}${filler}
  </app>
</body>
</html>
`;
    await fs.writeFile(path.join(root, "src", "index.html"), index);
  });
}