import { deterministicHash } from "./utils.js";

/**
 * Build runtime descriptors. This function never writes files.
 *
 * Order is deterministic: base chunk, module chunks sorted by module id, then
 * the DOMContentLoaded chunk.
 *
 * @param {{
 *   baseSource: string,
 *   moduleChunks?: Array<{
 *     id: string,
 *     canonical?: string|null,
 *     classSource?: string|null,
 *     runtimeSource?: string|null,
 *     imports?: string[],
 *     componentImports?: Array<{childId:string, local:string|null, canonical:string}>,
 *     sideEffectImports?: string[]
 *   }>,
 *   runtimeCalls?: Array<{moduleId:string, fnId:string, chid:string, ctxJson:string}>
 * }} options
 * @returns {Array<{name:string, content:string}>}
 */
export function generateRuntime({
  baseSource,
  moduleChunks = [],
  runtimeCalls = [],
}) {
  const files = [];
  const baseName = "run-" + deterministicHash(baseSource, 6) + ".js";
  files.push({ name: baseName, content: baseSource });

  const chunkNames = new Map();
  for (const chunk of moduleChunks) {
    chunkNames.set(
      chunk.id,
      "run-" + deterministicHash("module:" + chunk.id, 6) + ".js"
    );
  }

  const sortedChunks = [...moduleChunks].sort((a, b) =>
    a.id.localeCompare(b.id)
  );

  for (const chunk of sortedChunks) {
    const lines = [];

    for (const statement of chunk.imports || []) {
      const trimmed = statement.trim();
      if (trimmed) lines.push(trimmed);
    }

    if (chunk.classSource) {
      lines.push(`import { ChocolaComponent } from "./${baseName}";`);
    }

    const seenImports = new Set();
    for (const componentImport of chunk.componentImports || []) {
      const chunkName = chunkNames.get(componentImport.childId);
      if (!chunkName) continue;

      const key = `${componentImport.childId}#${componentImport.local || ""}`;
      if (seenImports.has(key)) continue;
      seenImports.add(key);

      if (componentImport.local) {
        lines.push(
          `import { ${componentImport.canonical} as ${componentImport.local} } from "./${chunkName}";`
        );
      } else {
        lines.push(
          `import { ${componentImport.canonical} } from "./${chunkName}";`
        );
      }
    }

    for (const childId of chunk.sideEffectImports || []) {
      const chunkName = chunkNames.get(childId);
      if (chunkName) lines.push(`import "./${chunkName}";`);
    }

    if (chunk.runtimeSource) {
      lines.push(`export ${chunk.runtimeSource}`);
    }

    if (chunk.classSource) {
      lines.push(chunk.classSource);
      if (chunk.canonical) lines.push(`export { ${chunk.canonical} };`);
    }

    if (lines.length > 0) {
      files.push({
        name: chunkNames.get(chunk.id),
        content: lines.join("\n") + "\n",
      });
    }
  }

  if (runtimeCalls.length > 0) {
    const aliasByModule = new Map();
    const importLines = [];
    const callLines = [];

    for (const call of runtimeCalls) {
      const chunkName = chunkNames.get(call.moduleId);
      if (!chunkName) continue;

      let alias = aliasByModule.get(call.moduleId);
      if (!alias) {
        alias = "__r" + aliasByModule.size;
        aliasByModule.set(call.moduleId, alias);
        importLines.push(
          `import { ${call.fnId} as ${alias} } from "./${chunkName}";`
        );
      }

      callLines.push(
        `  ${alias}(document.querySelector('[chid="${call.chid}"]'), ${
          call.ctxJson || "{}"
        });`
      );
    }

    if (callLines.length > 0) {
      const content =
        importLines.join("\n") +
        '\ndocument.addEventListener("DOMContentLoaded", () => {\n' +
        callLines.join("\n") +
        "\n});\n";

      files.push({
        name: "run-" + deterministicHash(content, 6) + ".js",
        content,
      });
    }
  }

  return files;
}
