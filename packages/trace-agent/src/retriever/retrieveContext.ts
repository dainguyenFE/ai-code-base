import type { TraceDatabase } from "@ai-trace/cache";
import {
  findSymbolByName,
  getEdgesForSymbol,
  loadRoutes,
  loadSymbols,
} from "@ai-trace/cache";
import type { DbSymbol } from "@ai-trace/cache";
import type { GraphEdge, RetrievedContext, TraceIntent } from "@ai-trace/types";

import { loadSourceSnippets } from "./loadSourceSnippets.js";

export interface RetrieveOptions {
  intent: TraceIntent;
  targetName: string;
  rootDir: string;
  maxContextFiles: number;
  maxGraphDepth: number;
}

export async function retrieveContext(
  db: TraceDatabase,
  options: RetrieveOptions
): Promise<RetrievedContext> {
  if (options.intent === "component_trace") {
    return retrieveComponentContext(db, options);
  }
  if (options.intent === "hook_trace") {
    return retrieveHookContext(db, options);
  }
  if (options.intent === "route_trace") {
    return retrieveRouteContext(db, options);
  }

  return {
    edges: [],
    files: [],
    intent: options.intent,
    symbols: [],
    targetName: options.targetName,
    warnings: [`Intent "${options.intent}" is not supported yet.`],
  };
}

async function retrieveComponentContext(
  db: TraceDatabase,
  options: RetrieveOptions
): Promise<RetrievedContext> {
  const symbol = findSymbolByName(db, options.targetName, "component");

  if (!symbol) {
    return emptyContext("component_trace", options.targetName, [
      `Component "${options.targetName}" not found in index. Run "ai-trace index" first.`,
    ]);
  }

  return collectSymbolContext(db, symbol, "component_trace", options);
}

async function retrieveHookContext(
  db: TraceDatabase,
  options: RetrieveOptions
): Promise<RetrievedContext> {
  const symbol = findSymbolByName(db, options.targetName, "hook");

  if (!symbol) {
    return emptyContext("hook_trace", options.targetName, [
      `Hook "${options.targetName}" not found in index. Run "ai-trace index" first.`,
    ]);
  }

  return collectSymbolContext(db, symbol, "hook_trace", options);
}

async function retrieveRouteContext(
  db: TraceDatabase,
  options: RetrieveOptions
): Promise<RetrievedContext> {
  const routes = loadRoutes(db);
  const route = routes.find(
    (item) =>
      item.path === options.targetName ||
      item.path === normalizeRoutePath(options.targetName)
  );

  if (!route) {
    return emptyContext("route_trace", options.targetName, [
      `Route "${options.targetName}" not found in index.`,
    ]);
  }

  const symbols = loadSymbols(db);
  const routeFiles = new Set(
    [
      route.pageFile,
      ...route.layoutFiles,
      route.loadingFile,
      route.errorFile,
      route.notFoundFile,
      route.routeHandlerFile,
    ].filter((file): file is string => Boolean(file))
  );

  const relatedSymbols = symbols.filter((symbol) =>
    routeFiles.has(symbol.filePath)
  );

  const edges: GraphEdge[] = [];
  for (const symbol of relatedSymbols) {
    edges.push(...getEdgesForSymbol(db, symbol.id));
  }

  const dedupedEdges = dedupeEdges(edges);
  const { files, warnings } = await loadSourceSnippets(
    options.rootDir,
    relatedSymbols.slice(0, options.maxContextFiles),
    options.maxContextFiles
  );

  return {
    edges: dedupedEdges,
    files,
    intent: "route_trace",
    symbols: relatedSymbols,
    targetName: route.path,
    warnings,
  };
}

async function collectSymbolContext(
  db: TraceDatabase,
  symbol: DbSymbol,
  intent: TraceIntent,
  options: RetrieveOptions
): Promise<RetrievedContext> {
  const allSymbols = loadSymbols(db);
  const symbolById = new Map(allSymbols.map((item) => [item.id, item]));

  const edges = collectEdgesWithinDepth(db, symbol.id, options.maxGraphDepth);
  const relatedIds = new Set<string>();

  for (const edge of edges) {
    if (edge.from !== symbol.id) {
      relatedIds.add(edge.from);
    }
    if (edge.to !== symbol.id) {
      relatedIds.add(edge.to);
    }
  }

  const relatedSymbols = [...relatedIds]
    .map((id) => symbolById.get(id))
    .filter((item): item is DbSymbol => Boolean(item));

  const orderedSymbols = [symbol, ...relatedSymbols].slice(
    0,
    options.maxContextFiles
  );

  const { files, warnings } = await loadSourceSnippets(
    options.rootDir,
    orderedSymbols,
    options.maxContextFiles
  );

  return {
    edges,
    files,
    intent,
    symbols: orderedSymbols,
    targetName: symbol.name,
    warnings,
  };
}

function collectEdgesWithinDepth(
  db: TraceDatabase,
  rootSymbolId: string,
  maxDepth: number
): GraphEdge[] {
  const collected = new Map<string, GraphEdge>();
  const visited = new Set<string>([rootSymbolId]);
  let frontier = [rootSymbolId];

  for (let depth = 0; depth < maxDepth; depth++) {
    const nextFrontier: string[] = [];

    for (const symbolId of frontier) {
      for (const edge of getEdgesForSymbol(db, symbolId)) {
        collected.set(edge.id, edge);

        const neighbor = edge.from === symbolId ? edge.to : edge.from;
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          nextFrontier.push(neighbor);
        }
      }
    }

    frontier = nextFrontier;
  }

  return [...collected.values()];
}

function dedupeEdges(edges: GraphEdge[]): GraphEdge[] {
  const seen = new Map<string, GraphEdge>();
  for (const edge of edges) {
    seen.set(edge.id, edge);
  }
  return [...seen.values()];
}

function normalizeRoutePath(routePath: string): string {
  return routePath.startsWith("/") ? routePath : `/${routePath}`;
}

function emptyContext(
  intent: TraceIntent,
  targetName: string,
  warnings: string[]
): RetrievedContext {
  return {
    edges: [],
    files: [],
    intent,
    symbols: [],
    targetName,
    warnings,
  };
}
