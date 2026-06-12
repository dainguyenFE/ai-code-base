import { existsSync } from "node:fs";
import path from "node:path";

import { loadConfig } from "@ai-trace/config";

import { runReindex } from "./reindex.js";

const STUDIO_DIR = path.resolve(import.meta.dirname, "../../../trace-studio");

export async function runStudio(
  cwd: string,
  options: { port?: number; refresh?: boolean; scope?: string }
): Promise<void> {
  const config = await loadConfig(cwd);
  const scope = options.scope ?? "default";
  const port = options.port ?? 3456;
  const autoRefresh =
    options.refresh === true || process.env.AI_TRACE_AUTO_REINDEX === "1";

  if (!existsSync(config.absoluteDbPath) || autoRefresh) {
    if (!existsSync(config.absoluteDbPath)) {
      console.log("No index found — running reindex...");
    } else {
      console.log("Refreshing index (build + clear cache + index)...");
    }

    await runReindex(cwd, { build: true, clean: true });
    console.log("");
  }

  if (!existsSync(STUDIO_DIR)) {
    console.error(`Trace Studio app not found at ${STUDIO_DIR}`);
    process.exit(1);
  }

  console.log(`Starting Trace Studio on http://localhost:${port}`);
  console.log(`Workspace: ${cwd}`);
  console.log(`Scope: ${scope}`);
  console.log(`Index: ${config.db.path}`);

  const proc = Bun.spawn(["bun", "run", "dev"], {
    cwd: STUDIO_DIR,
    env: {
      ...process.env,
      AI_TRACE_DB_PATH: config.absoluteDbPath,
      AI_TRACE_SCOPE: scope,
      AI_TRACE_WORKSPACE_ROOT: cwd,
      PORT: String(port),
    },
    stderr: "inherit",
    stdin: "inherit",
    stdout: "inherit",
  });

  const code = await proc.exited;
  process.exit(code);
}
