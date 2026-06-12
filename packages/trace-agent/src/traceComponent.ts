import type { TraceDatabase } from "@ai-trace/cache";
import {
  collectExpandedEdges,
  getEdgesForSymbol,
  loadFileParseMeta,
  loadRoutes,
  loadSymbols,
} from "@ai-trace/cache";
import type { TraceResult, TraceResultSections } from "@ai-trace/types";

import { formatTraceResult } from "./output/formatTraceOutput.js";
import { resolveTraceSymbol } from "./utils/resolveTraceSymbol.js";
import type { TraceSymbolOptions } from "./utils/resolveTraceSymbol.js";
import {
  buildDeepCallChainForComponent,
  buildDynamicImportLines,
  buildHookChainLines,
  buildPassedPropsLines,
  buildPropOriginLines,
  buildReceivedPropsLines,
  buildRenderTreeLines,
  buildUsageChain,
  collectRelatedFiles,
  collectTraceGraphNodes,
  describeBoundary,
  formatLines,
  formatSymbolRef,
  getDirectHooks,
  getOutboundRenders,
  TRACE_EDGE_TYPES,
} from "./utils/traceGraph.js";

export function traceComponent(
  db: TraceDatabase,
  name: string,
  options: TraceSymbolOptions = {}
): TraceResult {
  const { symbol, warnings: resolveWarnings } = resolveTraceSymbol(
    db,
    name,
    "component",
    options
  );

  const warnings: string[] = [...resolveWarnings];
  const localEdges = getEdgesForSymbol(db, symbol.id);
  const edges = collectExpandedEdges(db, symbol.id, {
    depth: 6,
    edgeTypes: TRACE_EDGE_TYPES,
  });
  const allSymbols = loadSymbols(db);
  const routes = loadRoutes(db);
  const fileFlags = loadFileParseMeta(db, symbol.filePath);
  const usage = buildUsageChain(symbol.id, allSymbols, localEdges, routes);

  const renders = getOutboundRenders(symbol.id, allSymbols, edges);
  const hooks = getDirectHooks(symbol.id, allSymbols, edges);
  const passedPropsLines = buildPassedPropsLines(symbol.id, allSymbols, edges);
  const propsReceivedLines = buildReceivedPropsLines(
    symbol.id,
    allSymbols,
    edges
  );
  const propOriginLines = buildPropOriginLines(symbol, allSymbols, edges);
  const callChainLines = buildDeepCallChainForComponent(
    symbol,
    allSymbols,
    edges
  );
  const dynamicImportLines = buildDynamicImportLines(
    symbol.id,
    allSymbols,
    edges
  );

  const renderTree = buildRenderTreeLines(symbol.id, allSymbols, edges);
  if (renderTree.length === 0 && (symbol.renders?.length ?? 0) > 0) {
    warnings.push(
      `Parser lists renders [${symbol.renders?.join(", ")}] but graph has no render edges — re-run index`
    );
  }

  const hookLines = hooks.flatMap((hook) =>
    buildHookChainLines(hook, allSymbols)
  );

  const props =
    symbol.props && symbol.props.length > 0 ? symbol.props.join(", ") : "none";

  if (hooks.length > 0 && fileFlags && !fileFlags.isClientComponent) {
    warnings.push(
      'Component uses hooks but "use client" was not detected — treat as client component'
    );
  }

  if (
    usage.directConsumers.length === 0 &&
    usage.routesAffected.length === 0 &&
    dynamicImportLines.length === 0
  ) {
    warnings.push(
      "No inbound usage edges — component may be unused or only referenced dynamically"
    );
  }

  if (dynamicImportLines.length > 0 && usage.directConsumers.length === 0) {
    warnings.push(
      "Component is loaded via dynamic import — check Dynamic imports section for entry points"
    );
  }

  const sections: TraceResultSections = {
    boundary: [
      describeBoundary(fileFlags, {
        symbolType: "component",
        usesHooks: hooks.length > 0,
      }),
    ],
    callChain: callChainLines.length > 0 ? callChainLines : undefined,
    dynamicImports:
      dynamicImportLines.length > 0 ? dynamicImportLines : undefined,
    entry: [
      `${symbol.name} — ${symbol.filePath}:${formatLines(symbol)}`,
      `props: ${props}`,
      symbol.signature ? `signature: ${symbol.signature}` : "",
    ].filter(Boolean),
    hooks: hookLines.length > 0 ? hookLines : ["none"],
    propOrigins: propOriginLines.length > 0 ? propOriginLines : undefined,
    propsPassed: passedPropsLines.length > 0 ? passedPropsLines : undefined,
    propsReceived:
      propsReceivedLines.length > 0 ? propsReceivedLines : undefined,
    related: collectRelatedFiles(symbol, allSymbols, edges, routes, usage),
    renderTree:
      renderTree.length > 0
        ? renderTree
        : renders.length > 0
          ? renders.map((child) => formatSymbolRef(child))
          : ["none"],
    usage: usage.lines,
  };

  const relatedFiles = sections.related ?? [symbol.filePath];
  const steps = [
    `Entry: ${symbol.filePath}:${formatLines(symbol)}`,
    `Props: ${props}`,
    passedPropsLines.length
      ? `Passes props: ${passedPropsLines.join("; ")}`
      : "Passes props: none",
    propsReceivedLines.length
      ? `Receives props: ${propsReceivedLines.length}`
      : "Receives props: none",
    callChainLines.length
      ? `Call chain hops: ${callChainLines.length}`
      : "Call chain: none",
    dynamicImportLines.length
      ? `Dynamic imports: ${dynamicImportLines.length}`
      : "Dynamic imports: none",
    hooks.length
      ? `Uses hooks: ${hooks.map((hook) => hook.name).join(", ")}`
      : "Uses hooks: none",
    usage.routesAffected.length
      ? `Routes affected: ${usage.routesAffected.join(", ")}`
      : usage.directConsumers.length
        ? `Used by: ${usage.directConsumers.map((consumer) => consumer.name).join(", ")}`
        : "Used by: unknown",
  ];

  return {
    createdAt: new Date().toISOString(),
    entryPoints: [`${symbol.filePath}:${formatLines(symbol)}`],
    graph: {
      edges,
      nodes: collectTraceGraphNodes(symbol, allSymbols, edges),
    },
    id: `trace_${name}`,
    query: `Trace component ${name}`,
    relatedFiles,
    relatedSymbols: [
      symbol.id,
      ...renders.map((child) => child.name),
      ...hooks.map((hook) => hook.name),
      ...usage.directConsumers.map((consumer) => consumer.name),
    ],
    sections,
    steps,
    summary: `${name} is a component at ${symbol.filePath}:${formatLines(symbol)}. Used by ${usage.directConsumers.length} direct consumer(s); affects ${usage.routesAffected.length} route(s).`,
    type: "component_trace",
    warnings,
  };
}

export { formatTraceResult };
