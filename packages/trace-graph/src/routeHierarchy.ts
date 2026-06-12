import type { GraphEdge, RouteInfo, SymbolInfo } from "@ai-trace/types";

/** Ancestor URL paths from root to the target route (inclusive). */
export function getAncestorRoutePaths(routePath: string): string[] {
  if (routePath === "/") {
    return ["/"];
  }

  const parts = routePath.split("/").filter(Boolean);
  const segments = ["/"];

  for (let index = 0; index < parts.length; index += 1) {
    segments.push(`/${parts.slice(0, index + 1).join("/")}`);
  }

  return segments;
}

/** Ordered layout files from root layout down to the target route segment. */
export function collectLayoutChain(
  routePath: string,
  routeByPath: Map<string, RouteInfo>
): string[] {
  const layouts: string[] = [];

  for (const segmentPath of getAncestorRoutePaths(routePath)) {
    const segment = routeByPath.get(segmentPath);
    if (!segment?.layoutFiles.length) {
      continue;
    }

    const sorted = [...segment.layoutFiles].toSorted();
    for (const layoutFile of sorted) {
      if (!layouts.includes(layoutFile)) {
        layouts.push(layoutFile);
      }
    }
  }

  return layouts;
}

export function routeByPathMap(routes: RouteInfo[]): Map<string, RouteInfo> {
  return new Map(routes.map((route) => [route.path, route]));
}

const ROUTE_BOUNDARY_EDGE_TYPES = new Set([
  "wraps",
  "shows_loading",
  "shows_error",
  "shows_not_found",
  "renders",
]);

const PAGE_TREE_EDGE_TYPES = new Set([
  "renders",
  "passes_prop",
  "uses_hook",
  "prop_source",
]);

function symbolIdForFile(symbols: SymbolInfo[], file?: string): string | null {
  if (!file) {
    return null;
  }

  const match = symbols.find(
    (symbol) => symbol.filePath === file && symbol.type === "component"
  );
  return match?.id ?? null;
}

/** Route-specific subgraph: nested layouts, loading/error branches, and page render tree only. */
export function collectRouteSubgraph(
  route: RouteInfo,
  routes: RouteInfo[],
  symbols: SymbolInfo[],
  edges: GraphEdge[]
): { edges: GraphEdge[]; nodeIds: Set<string> } {
  const routeMap = routeByPathMap(routes);
  const layoutChain = collectLayoutChain(route.path, routeMap);
  const nodeIds = new Set<string>([route.id]);
  const selected = new Map<string, GraphEdge>();

  let parentId = route.id;

  for (const layoutFile of layoutChain) {
    const layoutId = symbolIdForFile(symbols, layoutFile);
    if (!layoutId) {
      continue;
    }

    nodeIds.add(layoutId);

    const wrapEdge = edges.find(
      (edge) =>
        edge.from === parentId && edge.to === layoutId && edge.type === "wraps"
    );
    if (wrapEdge) {
      selected.set(wrapEdge.id, wrapEdge);
    }

    parentId = layoutId;
  }

  const boundaryParent = parentId;

  const boundaryFiles: {
    edgeType: GraphEdge["type"];
    file?: string;
  }[] = [
    { edgeType: "shows_loading", file: route.loadingFile },
    { edgeType: "shows_error", file: route.errorFile },
    { edgeType: "shows_not_found", file: route.notFoundFile },
  ];

  for (const boundary of boundaryFiles) {
    const targetId = symbolIdForFile(symbols, boundary.file);
    if (!targetId) {
      continue;
    }

    nodeIds.add(targetId);

    const boundaryEdge = edges.find(
      (edge) =>
        edge.from === boundaryParent &&
        edge.to === targetId &&
        edge.type === boundary.edgeType
    );
    if (boundaryEdge) {
      selected.set(boundaryEdge.id, boundaryEdge);
    }
  }

  const pageId = symbolIdForFile(symbols, route.pageFile);
  if (pageId) {
    nodeIds.add(pageId);

    const pageEdge = edges.find(
      (edge) =>
        edge.from === boundaryParent &&
        edge.to === pageId &&
        edge.type === "renders"
    );
    if (pageEdge) {
      selected.set(pageEdge.id, pageEdge);
    }

    const queue = [pageId];
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        continue;
      }

      for (const edge of edges) {
        if (edge.from !== current || !PAGE_TREE_EDGE_TYPES.has(edge.type)) {
          continue;
        }

        selected.set(edge.id, edge);

        if (!nodeIds.has(edge.to)) {
          nodeIds.add(edge.to);
          queue.push(edge.to);
        }
      }
    }
  }

  for (const edge of edges) {
    if (
      ROUTE_BOUNDARY_EDGE_TYPES.has(edge.type) &&
      nodeIds.has(edge.from) &&
      nodeIds.has(edge.to)
    ) {
      selected.set(edge.id, edge);
    }
  }

  return {
    edges: [...selected.values()],
    nodeIds,
  };
}
