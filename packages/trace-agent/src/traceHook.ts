import type { TraceDatabase } from "@ai-trace/cache";
import {
  collectExpandedEdges,
  getEdgesForSymbol,
  loadFileParseMeta,
  loadRoutes,
  loadSymbols,
} from "@ai-trace/cache";
import type { TraceResult, TraceResultSections } from "@ai-trace/types";

import { formatHookTrace } from "./output/formatTraceOutput.js";
import { resolveTraceSymbol } from "./utils/resolveTraceSymbol.js";
import type { TraceSymbolOptions } from "./utils/resolveTraceSymbol.js";
import {
  buildCallChainLines,
  buildDynamicImportLines,
  buildHookChainLines,
  buildUsageChain,
  describeBoundary,
  formatLines,
  formatSymbolRef,
  resolveSymbol,
  TRACE_EDGE_TYPES,
} from "./utils/traceGraph.js";

export function traceHook(
  db: TraceDatabase,
  name: string,
  options: TraceSymbolOptions = {}
): TraceResult {
  const { symbol, warnings: resolveWarnings } = resolveTraceSymbol(
    db,
    name,
    "hook",
    options
  );

  const warnings: string[] = [...resolveWarnings];

  const edges = getEdgesForSymbol(db, symbol.id);
  const allSymbols = loadSymbols(db);
  const routes = loadRoutes(db);
  const fileFlags = loadFileParseMeta(db, symbol.filePath);

  const usedBy = edges
    .filter((edge) => edge.to === symbol.id && edge.type === "uses_hook")
    .map((edge) => resolveSymbol(allSymbols, edge.from))
    .filter((consumer): consumer is NonNullable<typeof consumer> =>
      Boolean(consumer)
    );

  const usageLines: string[] = [];

  if (usedBy.length === 0) {
    usageLines.push("used by components: none");
    warnings.push("Hook has no component consumers in the index");
  } else {
    usageLines.push("used by components:");
    for (const consumer of usedBy) {
      usageLines.push(`  - ${formatSymbolRef(consumer)}`);
      const consumerUsage = buildUsageChain(
        consumer.id,
        allSymbols,
        getEdgesForSymbol(db, consumer.id),
        routes
      );
      if (consumerUsage.routesAffected.length > 0) {
        usageLines.push(
          `    routes via ${consumer.name}: ${consumerUsage.routesAffected.join(", ")}`
        );
      }
    }
  }

  const routePaths = new Set<string>();
  for (const consumer of usedBy) {
    const chain = buildUsageChain(
      consumer.id,
      allSymbols,
      getEdgesForSymbol(db, consumer.id),
      routes
    );
    for (const route of chain.routesAffected) {
      routePaths.add(route);
    }
  }

  if (routePaths.size > 0) {
    usageLines.push(
      `routes affected (transitive): ${[...routePaths].toSorted().join(", ")}`
    );
  } else {
    usageLines.push("routes affected (transitive): none detected");
  }

  const expandedEdges = collectExpandedEdges(db, symbol.id, {
    depth: 6,
    edgeTypes: TRACE_EDGE_TYPES,
  });
  const hookChain = buildHookChainLines(symbol, allSymbols, 3);
  const callChainLines = buildCallChainLines(
    symbol.id,
    allSymbols,
    expandedEdges
  );
  const dynamicImportLines = buildDynamicImportLines(
    symbol.id,
    allSymbols,
    edges
  );

  const sections: TraceResultSections = {
    boundary: [describeBoundary(fileFlags, { symbolType: "hook" })],
    callChain: callChainLines.length > 0 ? callChainLines : undefined,
    data: hookChain.filter((line) => line.includes("calls:")),
    dynamicImports:
      dynamicImportLines.length > 0 ? dynamicImportLines : undefined,
    entry: [
      `${symbol.name} — ${symbol.filePath}:${formatLines(symbol)}`,
      symbol.signature ? `signature: ${symbol.signature}` : "",
    ].filter(Boolean),
    hooks: hookChain,
    related: [symbol.filePath, ...usedBy.map((consumer) => consumer.filePath)],
    usage: usageLines,
  };

  const steps = [
    `Hook: ${symbol.name}`,
    `File: ${symbol.filePath}:${formatLines(symbol)}`,
    symbol.calls?.length ? `Calls: ${symbol.calls.join(", ")}` : "Calls: none",
    symbol.usesHooks?.length
      ? `Uses hooks: ${symbol.usesHooks.join(", ")}`
      : "Uses hooks: none",
    usedBy.length
      ? `Used by: ${usedBy.map((consumer) => consumer.name).join(", ")}`
      : "Used by: unknown",
    routePaths.size
      ? `Routes affected: ${[...routePaths].join(", ")}`
      : "Routes affected: none",
  ];

  return {
    createdAt: new Date().toISOString(),
    entryPoints: [`${symbol.filePath}:${formatLines(symbol)}`],
    graph: { edges, nodes: [] },
    id: `trace_hook_${name}`,
    query: `Trace hook ${name}`,
    relatedFiles: sections.related ?? [symbol.filePath],
    relatedSymbols: [symbol.id, ...usedBy.map((consumer) => consumer.name)],
    sections,
    steps,
    summary: `${name} is a hook at ${symbol.filePath}:${formatLines(symbol)}. Used by ${usedBy.length} component(s); affects ${routePaths.size} route(s).`,
    type: "hook_trace",
    warnings,
  };
}

export { formatHookTrace };
