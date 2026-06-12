import type { TraceEdge, TraceNode } from "./types";

export const DATA_FLOW_EDGE_TYPES = new Set([
  "calls",
  "uses_hook",
  "prop_source",
  "passes_prop",
  "sequence",
]);

export const DATA_FLOW_NODE_TYPES = new Set([
  "component",
  "hook",
  "service",
  "function",
  "builtin",
  "external",
  "prop",
  "variable",
]);

export function filterDataFlowEdges(edges: TraceEdge[]): TraceEdge[] {
  const seen = new Set<string>();

  return edges.filter((edge) => {
    if (!DATA_FLOW_EDGE_TYPES.has(edge.type)) {
      return false;
    }

    const key = `${edge.from}->${edge.to}:${edge.type}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function filterDataFlowNodes(nodes: TraceNode[]): TraceNode[] {
  return nodes.filter((node) => DATA_FLOW_NODE_TYPES.has(node.type));
}
