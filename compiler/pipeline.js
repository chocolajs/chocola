import { promises as fs } from "fs";
import { throwError, deterministicHash } from "./utils.js";
import { readMyFile, checkFile } from "./fs.js";
import path from "path";

export async function getComponents(libDir) {
  try {
    let componentsLib = [];
    let loadedComponents = new Map();
    let emptyComps = [];

    const components = await fs.readdir(libDir);

    if (!components) {
      throw Error(`The specified components folder ${libDir} could not be found.`);
    }

    const reads = components
      .filter(comp => comp.endsWith(".html"))
      .map(async (comp) => {
        try {
          const compPath = path.join(libDir, comp);
          const instance = await fs.readFile(compPath, "utf-8");

          if (instance === "" || instance.trim().length === 0) emptyComps.push(comp);

          loadedComponents.set(comp.toLowerCase(), instance);
          componentsLib.push(comp);
        } catch (err) {
          throwError(`Failed to load component "${comp}": ${err.message || err}`);
        }
      });

    await Promise.all(reads);

    return { componentsLib, loadedComponents, emptyComps };
  } catch (err) {
    throwError(`Failed to load components from ${libDir}: ${err.message}`);
  }
}

export async function getSrcIndex(srcPath) {
  const srcHtmlPath = path.join(srcPath, "index.html");

  const htmlExists = await checkFile(srcHtmlPath);

  let srcHtmlFile = null;

  if (htmlExists) {
    try {
      srcHtmlFile = await readMyFile(srcHtmlPath);
      return { srcHtmlFile, srcPath: srcHtmlPath };
    } catch (err) {
      throwError(err);
    }
  }
}

export async function processStylesheet(link, rootDir, srcDir, out) {
  try {
    const href = link.href;
    if (href.startsWith("http://") || href.startsWith("https://")) return;
    const stylesheetPath = path.join(rootDir, srcDir, href);
    const css = await fs.readFile(stylesheetPath, { encoding: "utf8" });
    const base = deterministicHash(css + href, 6);
    let cssFileName = "css-" + base + ".css";
    let counter = 0;
    while (out.ids.includes(cssFileName)) {
      cssFileName = "css-" + deterministicHash(css + href + counter++, 6) + ".css";
    }
    out.ids.push(cssFileName);

    out.files.push({ path: cssFileName, content: css });
    link.setAttribute("href", "./" + cssFileName);

    return css;
  } catch (err) {
    throwError(`Failed to process stylesheet: ${err}`);
  }
}

export async function processIcons(link, rootDir, srcDir, out) {
  try {
    const href = link.href;
    if (href.startsWith("http://") || href.startsWith("https://")) return;
    const iconPath = path.join(rootDir, srcDir, href);
    out.copies.push({ from: iconPath, to: path.join(out.outDir, href) });
  } catch (err) {
    throwError(`Failed to copy icon: ${err}`);
  }
}

export async function processScript(doc, script, rootDir, srcDir, out) {
  try {
    const src = script.getAttribute("src");
    if (src.startsWith("http://") || src.startsWith("https://")) return;
    const scriptPath = path.join(rootDir, srcDir, src);
    const content = await fs.readFile(scriptPath, { encoding: "utf8" });
    const base = deterministicHash(content + src, 6);
    let jsFileName = "js-" + base + ".js";
    let counter = 0;
    while (out.ids.includes(jsFileName)) {
      jsFileName = "js-" + deterministicHash(content + src + counter++, 6) + ".js";
    }
    out.ids.push(jsFileName);
    out.files.push({ path: jsFileName, content });

    const newScript = doc.createElement("script");
    for (const attr of script.attributes) {
      if (attr.name === "src") {
        newScript.setAttribute("src", "./" + jsFileName);
      } else {
        newScript.setAttribute(attr.name, attr.value);
      }
    }
    if (script.textContent.trim()) {
      newScript.textContent = script.textContent;
    }
    script.parentNode.replaceChild(newScript, script);
  } catch (err) {
    throwError(`Failed to process script: ${err}`);
  }
}

export async function copyStaticDir(srcPath, out) {
  const staticSrc = path.join(srcPath, "static");
  const staticDest = path.join(out.outDir, "static");
  try {
    await fs.access(staticSrc);
    out.copies.push({ from: staticSrc, to: staticDest, recursive: true });
  } catch {
  }
}
