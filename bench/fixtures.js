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
    "<script>",
    `  export let m${i} = "m${i}";`,
    "</script>",
    "<template>",
    `  <div class="${name}">`,
    `    <span>{m${i}}</span>`,
    "  </div>",
    "</template>",
    "<style>",
    `  .${name} { color: #000; }`,
    "</style>",
    "",
  ].join("\n");
}

function nestedComponentSource(name, i, depth) {
  const hasChild = i < depth;
  const importLine = hasChild ? `  import D${i + 1} from "./d${i + 1}.chjs";\n` : "";
  const childUsage = hasChild ? `    <D${i + 1} />\n` : "";
  return (
    `<script>\n${importLine}  export let v${i} = ${i};\n</script>\n` +
    `<template>\n  <div class="${name}">\n` +
    `    <span>depth ${i}</span>\n${childUsage}  </div>\n</template>\n`
  );
}

export async function makeSyntheticApp({ components = 0, depth = 0, rootTemplateKb = 0 } = {}) {
  return makeTempApp(async (root) => {
    const libDir = path.join(root, "lib");
    await fs.mkdir(libDir, { recursive: true });

    const imports = [];
    const usages = [];

    for (let i = 0; i < components; i++) {
      await fs.writeFile(
        path.join(libDir, `c${i}.chjs`),
        componentSource(`c${i}`, i)
      );
      imports.push(`  import C${i} from "./lib/c${i}.chjs";`);
      usages.push(`    <C${i} />`);
    }

    if (depth > 0) {
      for (let i = 0; i <= depth; i++) {
        const name = `d${i}`;
        await fs.writeFile(
          path.join(libDir, `${name}.chjs`),
          nestedComponentSource(name, i, depth)
        );
      }
      imports.push(`  import D0 from "./lib/d0.chjs";`);
      usages.push(`    <D0 />`);
    }

    let filler = "";
    if (rootTemplateKb > 0) {
      const block = "<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Padding text for large root templates.</p>";
      const reps = Math.max(1, Math.ceil((rootTemplateKb * 1024) / block.length));
      filler =
        "\n" +
        Array.from(
          { length: reps },
          (_, i) => `    <div class="pad${i % 10}">${block}</div>`
        ).join("\n");
    }

    const body = usages.length || filler ? `${usages.join("\n")}${filler}` : "    <div>empty</div>";
    const source =
      `<script>\n${imports.join("\n")}\n</script>\n` +
      `<template>\n  <main>\n${body}\n  </main>\n</template>\n`;
    await fs.writeFile(path.join(root, "app.chjs"), source);
  });
}
