import { genRandomId } from "./utils.js";

export function generateRuntimeScript(runtimeScript, csrSource, csrClasses) {
  const fileIds = [];
  const files = [];

  if (csrSource) {
    const name = "run-" + genRandomId(fileIds, 6) + ".js";
    const source = csrSource.replace(/^export\s+\{?\s*[^}]+\s*}?\s*;?\s*$/m, "");
    files.push({ path: name, content: source });
  }

  if (csrClasses) {
    const name = "run-" + genRandomId(fileIds, 6) + ".js";
    files.push({ path: name, content: csrClasses });
  }

  if (runtimeScript) {
    const name = "run-" + genRandomId(fileIds, 6) + ".js";
    const content = `document.addEventListener("DOMContentLoaded", () => {${runtimeScript}})`;
    files.push({ path: name, content });
  }

  return files;
}
