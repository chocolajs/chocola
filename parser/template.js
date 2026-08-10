import { compileExpr } from "./utils.js";
import { hasMountIf, getMountIf, removeMountIf } from "./context.js";

export const reservedAttrs = ["if", "mount:if", "elif", "else"];

export function getLineNumber(srcContent, parentContent, idxInParent) {
  if (srcContent === parentContent) {
    return parentContent.substring(0, idxInParent).split("\n").length;
  }
  const templateStartMatch = srcContent.match(/<template[^>]*>/);
  if (templateStartMatch) {
    const contentStart = templateStartMatch.index + templateStartMatch[0].length;
    const beforeContent = srcContent.substring(0, contentStart);
    const linesInBefore = beforeContent.split("\n").length;
    const linesInTemplate = parentContent.substring(0, idxInParent).split("\n").length;
    return linesInBefore + linesInTemplate - 1;
  }
  return null;
}

export function validateChainStructure(parent, sourceFile, sourceContent, parentContent) {
  const children = [...parent.children];
  let chainActive = false;

  for (const child of children) {
    const hasIf = child.hasAttribute("if");
    const hasDelIf = hasMountIf(child);
    const hasElif = child.hasAttribute("elif");
    const hasElse = child.hasAttribute("else");

    if (hasElif || hasElse) {
      if (!chainActive) {
        const tag = child.tagName.toLowerCase();
        const attr = hasElif ? "elif" : "else";
        let loc = sourceFile;
        if (sourceContent && parentContent) {
          const idx = parentContent.indexOf(child.outerHTML);
          if (idx !== -1) {
            const lineNum = getLineNumber(sourceContent, parentContent, idx);
            if (lineNum !== null) loc = `${sourceFile}:${lineNum}`;
          }
        }
        throw new Error(`${loc}\n    <${tag}> has ${attr} without a preceding if/mount:if sibling`);
      }
      if (hasElse) {
        chainActive = false;
      }
    }

    if (hasIf || hasDelIf) {
      chainActive = true;
    } else if (!hasElif && !hasElse) {
      chainActive = false;
    }

    validateChainStructure(child, sourceFile, sourceContent, parentContent);
  }
}

export function applyConditionalToElement(child, ctxProxy, condChain, hasIf, hasDelIf, hasElif, hasElse) {
  if (hasIf) {
    const expr = child.getAttribute("if").slice(1, -1);
    const fn = compileExpr(expr, true);
    condChain.active = true;
    if (fn(ctxProxy)) {
      condChain.rendered = true;
    } else {
      child.style.display = "none";
      condChain.rendered = false;
    }
    child.removeAttribute("if");
  } else if (hasDelIf) {
    const expr = getMountIf(child).slice(1, -1);
    const fn = compileExpr(expr, true);
    condChain.active = true;
    if (fn(ctxProxy)) {
      condChain.rendered = true;
    } else {
      child.remove();
      condChain.rendered = false;
    }
    removeMountIf(child);
  } else if (hasElif) {
    const expr = child.getAttribute("elif").slice(1, -1);
    const fn = compileExpr(expr, true);
    if (fn(ctxProxy)) {
      condChain.rendered = true;
    } else {
      child.remove();
    }
    child.removeAttribute("elif");
  } else if (hasElse) {
    condChain.rendered = true;
    condChain.active = false;
    child.removeAttribute("else");
  } else {
    condChain.active = false;
    condChain.rendered = false;
  }
}

export function interpolateNode(root, ctxProxy) {
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    if (node.nodeType === 3) {
      node.textContent = node.textContent.replace(/\{([^}]+)\}/g, (_, expr) => {
        try {
          return compileExpr(expr, true)(ctxProxy);
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
