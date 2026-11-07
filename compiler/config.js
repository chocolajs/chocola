/**
 * Compiler configuration is a plain object owned by the host.
 *
 * Core never reads `chocola.config.json` and never interprets `srcDir`,
 * `libDir`, `outDir`, or `emptyOutDir`. Unknown keys are passed through
 * untouched so hosts can carry their own settings.
 *
 * `treeShakeRuntime` only controls intra-module `$runtime` extraction; it does
 * not perform cross-module reachability.
 *
 * @param {object} [config]
 * @returns {object}
 */
export function normalizeConfig(config = {}) {
  return { treeShakeRuntime: true, ...config };
}
