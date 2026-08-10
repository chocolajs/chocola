import { promises as fs } from "fs";
import path from "path";
import { throwError } from "./compiler/utils.js";

export async function getConfig(__rootdir) {
    try {
        const config = await fs.readFile(path.join(__rootdir, "chocola.config.json"), "utf-8");
        return JSON.parse(config);
    } catch(err) {
        throwError("An error occurred while fetching the Chocola config file:\n" + err);
    }
}

const LBRACE_PH = "_%%CHOCOLA-LBRACE%%_";
const RBRACE_PH = "_%%CHOCOLA-RBRACE%%_";
const PROTECTED_REGEX = /_%%CHOCOLA-(?:AMP|LT|GT)\d+%%_/g;

let protectSeq = 0;

export function protectCurlyBraces(html) {
  return html
    .replace(/&(?:lbrace|#123|#x7B);/gi, LBRACE_PH)
    .replace(/&(?:rcub|#125|#x7D);/gi, RBRACE_PH)
    .split(/(<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>)/gi)
    .map((part, i) => i % 2 === 0
      ? part.replace(/\{([^{}]*)\}/g, (m, inner) =>
          `{${inner
            .replace(/&/g, () => `_%%CHOCOLA-AMP${protectSeq++}%%_`)
            .replace(/</g, () => `_%%CHOCOLA-LT${protectSeq++}%%_`)
            .replace(/>/g, () => `_%%CHOCOLA-GT${protectSeq++}%%_`)}}`)
      : part)
    .join("");
}

export function restoreCurlyBraces(html) {
  return html
    .replace(/_%%CHOCOLA-LBRACE%%_/g, "{")
    .replace(/_%%CHOCOLA-RBRACE%%_/g, "}")
    .replace(PROTECTED_REGEX, char => {
      if (char.includes("AMP")) return "&";
      if (char.includes("LT")) return "<";
      return ">";
    });
}

export function restoreTemplateChars(str) {
  return str.replace(PROTECTED_REGEX, char => {
    if (char.includes("AMP")) return "&";
    if (char.includes("LT")) return "<";
    return ">";
  });
}