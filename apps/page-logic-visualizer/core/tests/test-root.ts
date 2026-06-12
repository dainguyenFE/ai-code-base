import { existsSync } from "node:fs";
import path from "node:path";

/** Walk up from this file until `page-logic-visualizer.config.json` (monorepo root). */
export function resolveMonorepoRoot(): string {
  let dir = path.resolve(import.meta.dir, "..");

  while (true) {
    if (existsSync(path.join(dir, "page-logic-visualizer.config.json"))) {
      return dir;
    }

    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(
        "Monorepo root not found (missing page-logic-visualizer.config.json)"
      );
    }
    dir = parent;
  }
}
