import type { TraceDatabase } from "@ai-trace/cache";
import {
  getEdgesForSymbol,
  loadFileParseMeta,
  loadGraph,
  loadRoutes,
  loadSymbols,
} from "@ai-trace/cache";
import {
  collectLayoutChain,
  collectRouteSubgraph,
  routeByPathMap,
} from "@ai-trace/graph";
import type { TraceResult, TraceResultSections } from "@ai-trace/types";

import { formatRouteTrace } from "./output/formatTraceOutput.js";
import {
  buildDynamicImportLines,
  buildHookChainLines,
  buildPassedPropsLinesInSubtree,
  buildRenderTreeLines,
  describeBoundary,
  formatLines,
  formatSymbolRef,
  getDirectHooks,
  getOutboundRenders,
  resolveSymbol,
} from "./utils/traceGraph.js";

function normalizeRouteQuery(routePath: string): string {
  if (!routePath.startsWith("/")) {
    return `/${routePath}`;
  }
  return routePath;
}

export function traceRoute(db: TraceDatabase, routePath: string): TraceResult {
  const normalized = normalizeRouteQuery(routePath);
  const routes = loadRoutes(db);
  const route = routes.find(
    (item) => item.path === normalized || item.path === routePath
  );

  if (!route) {
    const available = routes
      .slice(0, 8)
      .map((item) => item.path)
      .join(", ");
    throw new Error(
      `Route "${routePath}" not found. Run "ai-trace index" first.${available ? ` Examples: ${available}` : ""}`
    );
  }

  const warnings: string[] = [];
  const symbols = loadSymbols(db);
  const graph = loadGraph(db);
  const pageSymbols = route.pageFile
    ? symbols.filter((symbol) => symbol.filePath === route.pageFile)
    : [];

  if (!route.pageFile) {
    warnings.push("Route has no page.tsx file in the index");
  }

  const { edges: routeEdges, nodeIds: routeNodeIds } = collectRouteSubgraph(
    route,
    routes,
    symbols,
    graph.edges
  );

  const pageSymbolIds = new Set(pageSymbols.map((symbol) => symbol.id));

  const routedComponents = routeEdges
    .filter(
      (edge) =>
        edge.type === "renders" &&
        pageSymbolIds.has(edge.from) &&
        edge.to !== edge.from
    )
    .map((edge) => resolveSymbol(symbols, edge.to))
    .filter((symbol): symbol is NonNullable<typeof symbol> => Boolean(symbol));

  const pageFlags = route.pageFile
    ? loadFileParseMeta(db, route.pageFile)
    : null;

  const renderTrees: string[] = [];
  const hookLines: string[] = [];
  const passedPropsLines: string[] = [];
  const dynamicImportLines: string[] = [];
  const relatedFiles = new Set<string>();

  for (const file of [
    route.pageFile,
    ...route.layoutFiles,
    route.loadingFile,
    route.errorFile,
    route.notFoundFile,
    route.routeHandlerFile,
  ]) {
    if (file) {
      relatedFiles.add(file);
    }
  }

  for (const pageSymbol of pageSymbols) {
    renderTrees.push(
      `${pageSymbol.name} (${pageSymbol.filePath}:${formatLines(pageSymbol)})`
    );
    renderTrees.push(
      ...buildRenderTreeLines(pageSymbol.id, symbols, graph.edges)
    );
    passedPropsLines.push(
      ...buildPassedPropsLinesInSubtree(pageSymbol.id, symbols, graph.edges)
    );
    dynamicImportLines.push(
      ...buildDynamicImportLines(pageSymbol.id, symbols, graph.edges)
    );

    for (const hook of getDirectHooks(pageSymbol.id, symbols, graph.edges)) {
      hookLines.push(...buildHookChainLines(hook, symbols));
      relatedFiles.add(hook.filePath);
    }

    for (const child of getOutboundRenders(
      pageSymbol.id,
      symbols,
      graph.edges
    )) {
      relatedFiles.add(child.filePath);
      for (const nestedHook of getDirectHooks(child.id, symbols, graph.edges)) {
        hookLines.push(...buildHookChainLines(nestedHook, symbols));
        relatedFiles.add(nestedHook.filePath);
      }
    }
  }

  const pageRenderIds = new Set(
    pageSymbols.flatMap((pageSymbol) =>
      getOutboundRenders(pageSymbol.id, symbols, graph.edges).map(
        (child) => child.id
      )
    )
  );

  for (const component of routedComponents) {
    relatedFiles.add(component.filePath);
    if (pageRenderIds.has(component.id)) {
      continue;
    }
    renderTrees.push(`routes_to: ${formatSymbolRef(component)}`);
    renderTrees.push(
      ...buildRenderTreeLines(component.id, symbols, graph.edges)
    );
  }

  const layoutChain = collectLayoutChain(route.path, routeByPathMap(routes));
  const layoutLines = layoutChain.map((file) => {
    const layoutSymbols = symbols.filter((symbol) => symbol.filePath === file);
    const names =
      layoutSymbols.length > 0
        ? layoutSymbols.map((symbol) => symbol.name).join(", ")
        : "(no exported layout component)";
    return `${file} → ${names}`;
  });

  const sections: TraceResultSections = {
    boundary: pageFlags ? [describeBoundary(pageFlags)] : ["boundary: unknown"],
    dynamicImports:
      dynamicImportLines.length > 0
        ? [...new Set(dynamicImportLines)]
        : undefined,
    entry: [
      `path: ${route.path}`,
      route.pageFile ? `page: ${route.pageFile}` : "page: none",
      pageSymbols.length
        ? `page components: ${pageSymbols.map((symbol) => formatSymbolRef(symbol)).join(", ")}`
        : "page components: none",
    ],
    hooks: hookLines.length > 0 ? [...new Set(hookLines)] : ["none"],
    layouts: [
      ...layoutLines,
      route.loadingFile ? `loading: ${route.loadingFile}` : "",
      route.errorFile ? `error: ${route.errorFile}` : "",
      route.notFoundFile ? `not-found: ${route.notFoundFile}` : "",
      route.routeHandlerFile ? `route handler: ${route.routeHandlerFile}` : "",
    ].filter(Boolean),
    propsPassed:
      passedPropsLines.length > 0 ? [...new Set(passedPropsLines)] : undefined,
    related: [...relatedFiles].toSorted(),
    renderTree: renderTrees.length > 0 ? renderTrees : ["none"],
    route: [`${route.path} → ${route.pageFile ?? "unknown page"}`],
    usage: [
      routedComponents.length
        ? `entry components: ${routedComponents.map((symbol) => symbol.name).join(", ")}`
        : "entry components: none (check page default export)",
      `layout wrappers: ${layoutChain.length}`,
    ],
  };

  const renders = pageSymbols.flatMap((symbol) => symbol.renders ?? []);

  const steps = [
    `Route: ${route.path}`,
    route.pageFile ? `Page: ${route.pageFile}` : "Page: none",
    layoutChain.length ? `Layouts: ${layoutChain.join(", ")}` : "Layouts: none",
    route.loadingFile ? `Loading: ${route.loadingFile}` : "",
    route.errorFile ? `Error: ${route.errorFile}` : "",
    renders.length ? `Renders: ${renders.join(", ")}` : "Renders: none",
    routedComponents.length
      ? `Routes to: ${routedComponents.map((symbol) => symbol.name).join(", ")}`
      : "",
  ].filter(Boolean);

  return {
    createdAt: new Date().toISOString(),
    entryPoints: route.pageFile ? [route.pageFile] : [],
    graph: {
      edges: routeEdges,
      nodes: graph.nodes.filter((node) => routeNodeIds.has(node.id)),
    },
    id: `trace_route_${route.path}`,
    query: `Trace route ${route.path}`,
    relatedFiles: sections.related ?? [],
    relatedSymbols: [
      ...pageSymbols.map((symbol) => symbol.name),
      ...routedComponents.map((symbol) => symbol.name),
      ...renders,
    ],
    sections,
    steps,
    summary: `Route ${route.path} maps to ${route.pageFile ?? "unknown page"} with ${layoutChain.length} nested layout(s) and ${routedComponents.length} rendered component target(s).`,
    type: "route_trace",
    warnings,
  };
}

export { formatRouteTrace };
