import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Two directories up from `dist/src` lands on the installed package root. Bundled fixtures are
 * resolved from here rather than from `process.cwd()`, so a command works from any directory.
 */
export const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export function bundledPath(relativePath: string): string {
  return resolve(packageRoot, relativePath);
}
