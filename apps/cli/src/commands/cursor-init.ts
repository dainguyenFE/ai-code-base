import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TOOL_ROOT = path.resolve(import.meta.dirname, "../../../../");

export async function runCursorInit(cwd: string): Promise<void> {
  const scriptPath = path.join(TOOL_ROOT, "scripts/generate-agent-rules.sh");

  const result = spawnSync("bash", [scriptPath, "--target", "all"], {
    cwd,
    env: { ...process.env, AI_TRACE_ROOT: cwd },
    stdio: "inherit",
  });

  if (result.status !== 0) {
    throw new Error(
      `generate-agent-rules.sh failed with exit code ${result.status ?? "unknown"}`
    );
  }
}
