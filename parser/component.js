export function extractPropsDefaults(script) {
  if (!script) return [];
  const propsRegex = /export\s+let\s+([a-zA-Z_$][0-9a-zA-Z_$]*)\s*(?:=\s*([^;]+))?;/g;
  let props = [];
  let match;
  while ((match = propsRegex.exec(script)) !== null) {
    props.push({ name: match[1].trim(), defaultValue: match[2]?.trim() });
  }
  return props;
}

export function extractRuntime(script, compName) {
  const startRegex = /(?:async\s+)?function\s+\$runtime\(([^)]*)\)\s*\{/;
  const match = script.match(startRegex);
  if (!match) return null;

  const startIndexBrace = match.index + match[0].length - 1;
  let bracesCount = 0;
  let inString = false;
  let stringChar = null;

  for (let i = startIndexBrace; i < script.length; i++) {
    const ch = script[i];

    if (inString) {
      if (ch === '\\') { i++; continue; }
      if (ch === stringChar) inString = false;
      continue;
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      inString = true;
      stringChar = ch;
      continue;
    }

    if (ch === '{') {
      bracesCount++;
    } else if (ch === '}') {
      bracesCount--;
      if (bracesCount === 0) {
        return script.substring(match.index, i + 1);
      }
    }
  }

  throw new Error(`${compName} $runtime function has unclosed curly braces`);
}

export function extractTopLevelVariables(script) {
  if (!script) return [];
  const vars = [];
  let i = 0;
  let depth = 0;
  let parenDepth = 0;
  let bracketDepth = 0;
  let inStr = false;
  let strChar = null;

  while (i < script.length) {
    const ch = script[i];

    if (inStr) {
      if (ch === "\\") i++;
      else if (ch === strChar) inStr = false;
      i++;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      inStr = true;
      strChar = ch;
      i++;
      continue;
    }

    if (ch === "/" && script[i + 1] === "/") {
      while (i < script.length && script[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && script[i + 1] === "*") {
      i += 2;
      while (i < script.length && !(script[i] === "*" && script[i + 1] === "/")) i++;
      i += 2;
      continue;
    }

    if (ch === "{") { depth++; i++; continue; }
    if (ch === "}") { depth--; i++; continue; }
    if (ch === "(") { parenDepth++; i++; continue; }
    if (ch === ")") { parenDepth--; i++; continue; }
    if (ch === "[") { bracketDepth++; i++; continue; }
    if (ch === "]") { bracketDepth--; i++; continue; }

    if (depth === 0 && parenDepth === 0 && bracketDepth === 0) {
      const rest = script.slice(i);
      const m = rest.match(/^(let|const)\s+([a-zA-Z_$][0-9a-zA-Z_$]*)\s*/);
      if (m) {
        const keyword = m[1];
        const before = script.slice(0, i).trimEnd();
        if (!before.endsWith("export")) {
          let name = m[2];
          let p = i + m[0].length;
          while (p < script.length && /\s/.test(script[p])) p++;
          i = p;

          while (p < script.length) {
            i = p;
            let q = p;

            if (script[q] === "=") {
              q++;
              while (q < script.length && /\s/.test(script[q])) q++;
              const delim = findDeclaratorEnd(script, q);
              if (name !== "self" && name !== "ctx") {
                vars.push({ keyword, name, value: script.slice(q, delim).trim() });
              }
              if (script[delim] === ";") { i = delim + 1; break; }
              p = delim + 1;
              while (p < script.length && /\s/.test(script[p])) p++;
            } else {
              if (name !== "self" && name !== "ctx") {
                vars.push({ keyword, name, value: undefined });
              }
              if (script[q] === ";") { i = q + 1; break; }
              if (script[q] !== ",") { i = q; break; }
              p = q + 1;
              while (p < script.length && /\s/.test(script[p])) p++;
            }

            const nameMatch = script.slice(p).match(/^([a-zA-Z_$][0-9a-zA-Z_$]*)\s*/);
            if (!nameMatch) { i = p; break; }
            name = nameMatch[1];
            p += nameMatch[0].length;
          }
          continue;
        }
      }
    }
    i++;
  }

  return vars;
}

function findDeclaratorEnd(script, start) {
  let i = start;
  let parens = 0;
  let brackets = 0;
  let braces = 0;
  let inStr = false;
  let strChar = null;

  while (i < script.length) {
    const c = script[i];

    if (inStr) {
      if (c === "\\") i++;
      else if (c === strChar) inStr = false;
      i++;
      continue;
    }

    if (c === "/" && script[i + 1] === "/") {
      while (i < script.length && script[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && script[i + 1] === "*") {
      i += 2;
      while (i < script.length && !(script[i] === "*" && script[i + 1] === "/")) i++;
      i += 2;
      continue;
    }

    if (c === '"' || c === "'" || c === "`") { inStr = true; strChar = c; i++; continue; }
    if (c === "(") { parens++; i++; continue; }
    if (c === ")") { parens--; i++; continue; }
    if (c === "[") { brackets++; i++; continue; }
    if (c === "]") { brackets--; i++; continue; }
    if (c === "{") { braces++; i++; continue; }
    if (c === "}") { braces--; i++; continue; }
    if ((c === ";" || c === ",") && parens === 0 && brackets === 0 && braces === 0) return i;
    i++;
  }

  return i;
}

export function extractTopLevelFunctions(script, excludeName) {
  const funcs = [];
  let i = 0;
  let depth = 0;
  let inStr = false;
  let strChar = null;

  while (i < script.length) {
    const ch = script[i];

    if (inStr) {
      if (ch === '\\') i++;
      else if (ch === strChar) inStr = false;
      i++;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      inStr = true;
      strChar = ch;
      i++;
      continue;
    }

    if (ch === '{') { depth++; i++; continue; }
    if (ch === '}') { depth--; i++; continue; }

    if (depth === 0) {
      const rest = script.slice(i);
      const m = rest.match(/^(?:async\s+)?function\s+([a-zA-Z_$][0-9a-zA-Z_$]*)\s*\(/);
      if (m) {
        const name = m[1];
        const pastParen = i + m[0].length;

        let parenDepth = 1;
        let p = pastParen;
        while (p < script.length && parenDepth > 0) {
          if (script[p] === '(') parenDepth++;
          if (script[p] === ')') parenDepth--;
          p++;
        }

        while (p < script.length && script[p] !== '{') p++;
        if (p >= script.length) { i++; continue; }

        let bDepth = 1;
        let bodyStr = false;
        let bodyStrChar = null;
        let end = p + 1;
        while (end < script.length && bDepth > 0) {
          const c = script[end];
          if (bodyStr) {
            if (c === '\\') end++;
            else if (c === bodyStrChar) bodyStr = false;
            end++;
            continue;
          }
          if (c === '"' || c === "'" || c === '`') {
            bodyStr = true;
            bodyStrChar = c;
            end++;
            continue;
          }
          if (c === '{') bDepth++;
          if (c === '}') bDepth--;
          end++;
        }

        if (name !== excludeName) {
          funcs.push(script.slice(i, end));
        }
        i = end;
        continue;
      }
    }
    i++;
  }

  return funcs;
}
