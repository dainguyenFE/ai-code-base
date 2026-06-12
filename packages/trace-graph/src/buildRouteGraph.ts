import path from "node:path";

import type {
  GraphEdge,
  GraphNode,
  GraphNodeType,
  ParsedFile,
  RouteInfo,
  SymbolInfo,
} from "@ai-trace/types";

import { collectLayoutChain, routeByPathMap } from "./routeHierarchy.js";

type SegmentRole = "layout" | "page" | "loading" | "error" | "not_found";

function makeEdgeId(from: string, to: string, type: string): string {
  return `${from}->${to}:${type}`;
}

function symbolNodeId(symbol: SymbolInfo): string {
  return symbol.id;
}

function resolveComponentInFile(
  filePath: string,
  symbolsByName: Map<string, SymbolInfo[]>,
  allSymbols: SymbolInfo[]
): SymbolInfo | null {
  const inFile = allSymbols.filter(
    (symbol) => symbol.filePath === filePath && symbol.type === "component"
  );
  if (inFile.length > 0) {
    return inFile[0];
  }

  void symbolsByName;
  return null;
}

function segmentNodeId(role: SegmentRole, filePath: string): string {
  return `${role}:${filePath}`;
}

function ensureSegmentNode(
  role: SegmentRole,
  filePath: string,
  allSymbols: SymbolInfo[],
  symbolsByName: Map<string, SymbolInfo[]>,
  addNode: (node: GraphNode) => void
): string {
  const component = resolveComponentInFile(filePath, symbolsByName, allSymbols);
  if (component) {
    addNode({
      filePath,
      id: symbolNodeId(component),
      label: component.name,
      type: role as GraphNodeType,
    });
    return symbolNodeId(component);
  }

  const id = segmentNodeId(role, filePath);
  addNode({
    filePath,
    id,
    label: path.basename(filePath),
    type: role as GraphNodeType,
  });
  return id;
}

function resolveRenderTarget(
  name: string,
  fromFile: string,
  parsedFiles: ParsedFile[],
  knownPaths: Set<string>,
  symbolsByName: Map<string, SymbolInfo[]>,
  resolveSymbolTargetFromImports: (
    name: string,
    fromFile: string
  ) => string | null,
  resolveSymbolTarget: (name: string) => string | null
): string | null {
  return (
    resolveSymbolTargetFromImports(name, fromFile) ?? resolveSymbolTarget(name)
  );
}

export function buildRouteGraphEdges(input: {
  routes: RouteInfo[];
  parsedFiles: ParsedFile[];
  knownPaths: Set<string>;
  symbolsByName: Map<string, SymbolInfo[]>;
  allSymbols: SymbolInfo[];
  addNode: (node: GraphNode) => void;
  addEdge: (edge: GraphEdge) => void;
  resolveSymbolTargetFromImports: (
    name: string,
    fromFile: string
  ) => string | null;
  resolveSymbolTarget: (name: string) => string | null;
}): void {
  const {
    routes,
    parsedFiles,
    knownPaths,
    symbolsByName,
    allSymbols,
    addNode,
    addEdge,
    resolveSymbolTargetFromImports,
    resolveSymbolTarget,
  } = input;

  const routeMap = routeByPathMap(routes);

  for (const route of routes) {
    if (!route.pageFile && route.layoutFiles.length === 0) {
      continue;
    }

    const layoutFiles = collectLayoutChain(route.path, routeMap);
    let parentId = route.id;

    for (const layoutFile of layoutFiles) {
      const layoutId = ensureSegmentNode(
        "layout",
        layoutFile,
        allSymbols,
        symbolsByName,
        addNode
      );

      addEdge({
        from: parentId,
        id: makeEdgeId(parentId, layoutId, "wraps"),
        metadata: { segmentRole: "layout" },
        to: layoutId,
        type: "wraps",
      });

      parentId = layoutId;
    }

    const boundaryParent = parentId;

    if (route.loadingFile) {
      const loadingId = ensureSegmentNode(
        "loading",
        route.loadingFile,
        allSymbols,
        symbolsByName,
        addNode
      );

      addEdge({
        from: boundaryParent,
        id: makeEdgeId(boundaryParent, loadingId, "shows_loading"),
        metadata: { boundary: "suspense" },
        to: loadingId,
        type: "shows_loading",
      });
    }

    if (route.errorFile) {
      const errorId = ensureSegmentNode(
        "error",
        route.errorFile,
        allSymbols,
        symbolsByName,
        addNode
      );

      addEdge({
        from: boundaryParent,
        id: makeEdgeId(boundaryParent, errorId, "shows_error"),
        metadata: { boundary: "error" },
        to: errorId,
        type: "shows_error",
      });
    }

    if (route.notFoundFile) {
      const notFoundId = ensureSegmentNode(
        "not_found",
        route.notFoundFile,
        allSymbols,
        symbolsByName,
        addNode
      );

      addEdge({
        from: boundaryParent,
        id: makeEdgeId(boundaryParent, notFoundId, "shows_not_found"),
        metadata: { boundary: "not-found" },
        to: notFoundId,
        type: "shows_not_found",
      });
    }

    if (!route.pageFile) {
      continue;
    }

    const pageId = ensureSegmentNode(
      "page",
      route.pageFile,
      allSymbols,
      symbolsByName,
      addNode
    );

    addEdge({
      from: boundaryParent,
      id: makeEdgeId(boundaryParent, pageId, "renders"),
      metadata: { segmentRole: "page" },
      to: pageId,
      type: "renders",
    });

    const pageComponent = resolveComponentInFile(
      route.pageFile,
      symbolsByName,
      allSymbols
    );
    if (!pageComponent) {
      continue;
    }

    for (const render of pageComponent.renders ?? []) {
      const toId = resolveRenderTarget(
        render,
        pageComponent.filePath,
        parsedFiles,
        knownPaths,
        symbolsByName,
        resolveSymbolTargetFromImports,
        resolveSymbolTarget
      );
      if (toId) {
        addEdge({
          from: pageId,
          id: makeEdgeId(pageId, toId, "renders"),
          to: toId,
          type: "renders",
        });
      }
    }
  }
}
