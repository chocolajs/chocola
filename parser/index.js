export { extractPropsDefaults, extractRuntime, extractTopLevelFunctions, extractTopLevelVariables } from "./component.js";
export { parseScript, extractBindingNames, computeReachable } from "./script.js";
export { extractCtxFromEl, hasMountIf, getMountIf, removeMountIf } from "./context.js";
export { reservedAttrs, getLineNumber, validateChainStructure, applyConditionalToElement, interpolateNode } from "./template.js";
export { scopeCss } from "./css.js";
export { compileExpr, evaluateConstant } from "./utils.js";
