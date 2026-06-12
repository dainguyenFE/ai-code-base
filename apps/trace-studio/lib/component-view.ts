import type { TraceEdge, TraceNode } from "./types";

/** Edges shown on the component composition graph. */
export const COMPONENT_GRAPH_EDGE_TYPES = new Set([
  "routes_to",
  "wraps",
  "shows_loading",
  "shows_error",
  "shows_not_found",
  "renders",
  "passes_prop",
]);

export const COMPONENT_NODE_TYPES = new Set([
  "component",
  "route",
  "page",
  "layout",
  "loading",
  "error",
  "not_found",
]);

export function isComponentGraphNode(node: TraceNode): boolean {
  return COMPONENT_NODE_TYPES.has(node.type);
}

export function filterComponentGraphNodes(nodes: TraceNode[]): TraceNode[] {
  return nodes.filter(isComponentGraphNode);
}

export function filterComponentGraphEdges(edges: TraceEdge[]): TraceEdge[] {
  const byPair = new Map<string, TraceEdge>();

  for (const edge of edges) {
    if (!COMPONENT_GRAPH_EDGE_TYPES.has(edge.type)) {
      continue;
    }

    const key = `${edge.from}->${edge.to}`;
    const existing = byPair.get(key);

    if (!existing || edge.type === "passes_prop") {
      byPair.set(key, edge);
    }
  }

  return [...byPair.values()];
}

export function buildNodeBadges(node: TraceNode): string[] {
  const badges: string[] = [];
  const meta = node.metadata;
  if (!meta) {
    return badges;
  }

  const childCount = meta.children?.length ?? meta.renders?.length ?? 0;
  if (childCount > 0) {
    badges.push(`${childCount} child${childCount === 1 ? "" : "ren"}`);
  }

  const hookCount = meta.usesHooks?.length ?? 0;
  if (hookCount > 0) {
    badges.push(`${hookCount} hook${hookCount === 1 ? "" : "s"}`);
  }

  const callCount = meta.calls?.length ?? 0;
  if (callCount > 0) {
    badges.push(`${callCount} call${callCount === 1 ? "" : "s"}`);
  }

  return badges;
}
