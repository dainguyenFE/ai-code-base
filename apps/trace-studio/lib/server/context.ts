import { existsSync } from "node:fs";
import path from "node:path";

import { loadConfig } from "@ai-trace/config";
import type { ResolvedConfig } from "@ai-trace/config";

export interface TraceStudioContext {
  workspaceRoot: string;
  scope: string;
  dbPath: string;
}

export type LoadedTraceStudioContext = TraceStudioContext & {
  config: ResolvedConfig;
};

export function getTraceStudioContext(): TraceStudioContext {
  const workspaceRoot = process.env.AI_TRACE_WORKSPACE_ROOT;
  const dbPath = process.env.AI_TRACE_DB_PATH;
  const scope = process.env.AI_TRACE_SCOPE ?? "default";

  if (!workspaceRoot) {
    throw new Error(
      "AI_TRACE_WORKSPACE_ROOT is not set. Start studio via: ai-trace studio"
    );
  }

  if (!dbPath) {
    throw new Error(
      "AI_TRACE_DB_PATH is not set. Start studio via: ai-trace studio"
    );
  }

  if (!existsSync(dbPath)) {
    throw new Error(`Index not found at ${dbPath}. Run: ai-trace index`);
  }

  return {
    dbPath: path.resolve(dbPath),
    scope,
    workspaceRoot: path.resolve(workspaceRoot),
  };
}

export async function loadTraceStudioContext(): Promise<LoadedTraceStudioContext> {
  const base = getTraceStudioContext();
  const config = await loadConfig(base.workspaceRoot);

  return {
    ...base,
    config,
    dbPath: config.absoluteDbPath,
  };
}

export async function withDatabase<T>(
  fn: (db: import("@ai-trace/cache").TraceDatabase) => T
): Promise<T> {
  const { openDatabase } = await import("@ai-trace/cache");
  const { dbPath } = getTraceStudioContext();
  const db = openDatabase(dbPath);

  try {
    return fn(db);
  } finally {
    db.close();
  }
}
