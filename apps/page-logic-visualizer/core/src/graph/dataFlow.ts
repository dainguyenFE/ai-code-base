import type {
  LogicGraphEdge,
  LogicGraphNode,
  NodeCategory,
  PageLogicGraph,
} from "../types";

export interface DataFlowLayer {
  category: NodeCategory;
  label: string;
  nodes: LogicGraphNode[];
}

const CATEGORY_LABELS: Record<NodeCategory, string> = {
  data: "Data inputs",
  logic: "Logic & hooks",
  ui: "UI output",
};

const inferCategory = (node: LogicGraphNode): NodeCategory => {
  const meta = node.metadata?.category;
  if (meta === "data" || meta === "logic" || meta === "ui") {
    return meta;
  }
  if (
    node.type === "data-fetch" ||
    node.type === "context" ||
    node.type === "store"
  ) {
    return "data";
  }
  if (node.type === "hook") {
    return "logic";
  }
  if (node.type === "condition" || node.type === "loop") {
    return "logic";
  }
  if (node.type === "ui-content" || node.type === "component") {
    return "ui";
  }
  return "ui";
};

export const buildDataFlowLayers = (graph: PageLogicGraph): DataFlowLayer[] => {
  const buckets: Record<NodeCategory, LogicGraphNode[]> = {
    data: [],
    logic: [],
    ui: [],
  };

  for (const node of graph.nodes) {
    if (
      node.type === "page" ||
      node.type === "route" ||
      node.type === "layout"
    ) {
      continue;
    }
    buckets[inferCategory(node)].push(node);
  }

  return (["data", "logic", "ui"] as const).map((category) => ({
    category,
    label: CATEGORY_LABELS[category],
    nodes: buckets[category],
  }));
};

export const getNodeFlowSummary = (
  node: LogicGraphNode
): string | undefined => {
  if (node.hook) {
    const inputs = node.hook.inputs.map((field) => field.source ?? field.name);
    const outputs = node.hook.outputs.map((field) => field.name);
    return `in: ${inputs.join(", ") || "—"} → out: ${outputs.join(", ") || "—"}`;
  }
  if (node.uiContent) {
    return `${node.uiContent.contentKind}: ${node.uiContent.preview}`;
  }
  if (node.context) {
    return `context: ${node.context.contextName}`;
  }
  if (node.store) {
    return `${node.store.library} store → ${node.store.outputNames?.join(", ") ?? "state"}`;
  }
  if (node.dataFetch?.outputNames?.length) {
    const kind = node.dataFetch.sourceKind === "function" ? "fn" : "api";
    return `${kind} → ${node.dataFetch.outputNames.join(", ")}`;
  }
  return undefined;
};

export const getUpstreamNodes = (
  graph: PageLogicGraph,
  nodeId: string
): LogicGraphNode[] => {
  const parentIds = new Set(
    graph.edges
      .filter((edge) => edge.target === nodeId)
      .map((edge) => edge.source)
  );
  return graph.nodes.filter((node) => parentIds.has(node.id));
};

export const getDownstreamNodes = (
  graph: PageLogicGraph,
  nodeId: string
): LogicGraphNode[] => {
  const childIds = new Set(
    graph.edges
      .filter((edge) => edge.source === nodeId)
      .map((edge) => edge.target)
  );
  return graph.nodes.filter((node) => childIds.has(node.id));
};

export const getDataFlowEdges = (graph: PageLogicGraph): LogicGraphEdge[] =>
  graph.edges.filter((edge) =>
    [
      "calls",
      "uses-hook",
      "hook-input",
      "hook-output",
      "condition-true",
      "condition-false",
      "displays",
      "passes-props",
    ].includes(edge.type)
  );
