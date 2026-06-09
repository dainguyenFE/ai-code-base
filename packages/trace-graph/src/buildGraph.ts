import type {
  CodeGraph,
  GraphEdge,
  GraphNode,
  ParsedFile,
  RouteInfo,
  ScannedFile,
  SymbolInfo,
} from "@ai-trace/types";
import { detectRoutes } from "./detectRoutes.js";

function makeEdgeId(from: string, to: string, type: string): string {
  return `${from}->${to}:${type}`;
}

function symbolNodeId(symbol: SymbolInfo): string {
  return symbol.id;
}

function resolveSymbolTarget(
  name: string,
  allSymbols: Map<string, SymbolInfo[]>
): string | null {
  const candidates = allSymbols.get(name);
  if (!candidates || candidates.length === 0) return null;

  const preferred =
    candidates.find((s) => s.type === "component") ??
    candidates.find((s) => s.type === "hook") ??
    candidates[0];

  return preferred ? symbolNodeId(preferred) : null;
}

export function buildGraph(
  parsedFiles: ParsedFile[],
  scannedFiles: ScannedFile[],
  routes: RouteInfo[] = detectRoutes(scannedFiles)
): CodeGraph {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const symbolsByName = new Map<string, SymbolInfo[]>();

  const addNode = (node: GraphNode) => {
    nodes.set(node.id, node);
  };

  const addEdge = (edge: GraphEdge) => {
    edges.set(edge.id, edge);
  };

  for (const file of scannedFiles) {
    addNode({
      id: `file:${file.path}`,
      type: "file",
      label: file.path,
      filePath: file.path,
    });
  }

  for (const route of routes) {
    addNode({
      id: route.id,
      type: "route",
      label: route.path,
      filePath: route.pageFile,
    });
  }

  for (const parsed of parsedFiles) {
    for (const imp of parsed.imports) {
      const fromId = `file:${parsed.filePath}`;
      const toId = `file:${imp.source}`;
      addEdge({
        id: makeEdgeId(fromId, toId, "imports"),
        from: fromId,
        to: toId,
        type: "imports",
      });
    }

    for (const symbol of parsed.symbols) {
      addNode({
        id: symbolNodeId(symbol),
        type:
          symbol.type === "component"
            ? "component"
            : symbol.type === "hook"
              ? "hook"
              : symbol.type === "service"
                ? "service"
                : "function",
        label: symbol.name,
        filePath: symbol.filePath,
      });

      const list = symbolsByName.get(symbol.name) ?? [];
      list.push(symbol);
      symbolsByName.set(symbol.name, list);
    }
  }

  for (const parsed of parsedFiles) {
    for (const symbol of parsed.symbols) {
      const fromId = symbolNodeId(symbol);

      for (const render of symbol.renders ?? []) {
        const toId = resolveSymbolTarget(render, symbolsByName);
        if (toId) {
          addEdge({
            id: makeEdgeId(fromId, toId, "renders"),
            from: fromId,
            to: toId,
            type: "renders",
          });
        }
      }

      for (const hook of symbol.usesHooks ?? []) {
        const toId = resolveSymbolTarget(hook, symbolsByName);
        if (toId) {
          addEdge({
            id: makeEdgeId(fromId, toId, "uses_hook"),
            from: fromId,
            to: toId,
            type: "uses_hook",
          });
        }
      }

      for (const call of symbol.calls ?? []) {
        const toId = resolveSymbolTarget(call, symbolsByName);
        if (toId && toId !== fromId) {
          addEdge({
            id: makeEdgeId(fromId, toId, "calls"),
            from: fromId,
            to: toId,
            type: "calls",
          });
        }
      }
    }
  }

  for (const route of routes) {
    if (!route.pageFile) continue;

    const pageParsed = parsedFiles.find((p) => p.filePath === route.pageFile);
    if (!pageParsed) continue;

    for (const symbol of pageParsed.symbols) {
      for (const render of symbol.renders ?? []) {
        const toId = resolveSymbolTarget(render, symbolsByName);
        if (toId) {
          addEdge({
            id: makeEdgeId(route.id, toId, "routes_to"),
            from: route.id,
            to: toId,
            type: "routes_to",
          });
        }
      }
    }
  }

  return {
    nodes: [...nodes.values()],
    edges: [...edges.values()],
  };
}
