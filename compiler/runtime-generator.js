import { deterministicHash } from "./utils.js";

export function generateRuntimeScript(runtimeScript, csrSource, csrClasses) {
  const files = [];

  if (csrSource) {
    const source = csrSource.replace(/^export\s+\{?\s*[^}]+\s*}?\s*;?\s*$/m, "");
    const name = "run-" + deterministicHash(source, 6) + ".js";
    files.push({ path: name, content: source });
  }

  if (csrClasses) {
    const name = "run-" + deterministicHash(csrClasses, 6) + ".js";
    files.push({ path: name, content: csrClasses });
  }

  if (runtimeScript) {
    const content = `document.addEventListener("DOMContentLoaded", () => {${runtimeScript}})`;
    const name = "run-" + deterministicHash(content, 6) + ".js";
    files.push({ path: name, content });
  }

  return files;
}
