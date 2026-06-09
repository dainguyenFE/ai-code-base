import type { TraceDatabase } from "@ai-trace/cache";
import {
  findSymbolByName,
  getEdgesForSymbol,
  loadSymbols,
} from "@ai-trace/cache";
import type { TraceResult } from "@ai-trace/types";

export function traceHook(db: TraceDatabase, name: string): TraceResult {
  const symbol = findSymbolByName(db, name, "hook");

  if (!symbol) {
    throw new Error(`Hook "${name}" not found. Run "ai-trace index" first.`);
  }

  const edges = getEdgesForSymbol(db, symbol.id);
  const allSymbols = loadSymbols(db);

  const usedBy = edges
    .filter((e) => e.to === symbol.id && e.type === "uses_hook")
    .map((e) => allSymbols.find((s) => s.id === e.from)?.name)
    .filter(Boolean) as string[];

  const calls = symbol.calls ?? [];
  const innerHooks = symbol.usesHooks ?? [];

  const steps = [
    `Hook: ${symbol.name}`,
    `File: ${symbol.filePath}`,
    calls.length ? `Calls: ${calls.join(", ")}` : "Calls: none",
    innerHooks.length
      ? `Uses hooks: ${innerHooks.join(", ")}`
      : "Uses hooks: none",
    usedBy.length ? `Used by: ${usedBy.join(", ")}` : "Used by: unknown",
  ];

  return {
    id: `trace_hook_${name}`,
    query: `Trace hook ${name}`,
    type: "hook_trace",
    summary: `${name} is a hook in ${symbol.filePath}.`,
    entryPoints: [symbol.filePath],
    relatedFiles: [symbol.filePath],
    relatedSymbols: [symbol.id, ...usedBy],
    graph: { nodes: [], edges: edges },
    steps,
    warnings: [],
    createdAt: new Date().toISOString(),
  };
}
