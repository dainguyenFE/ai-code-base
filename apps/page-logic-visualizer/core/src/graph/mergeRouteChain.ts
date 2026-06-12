import type { LogicGraphNode, PageLogicGraph, RouteChainEntry } from "../types";

const remapGraph = (
  graph: PageLogicGraph,
  prefix: string
): { graph: PageLogicGraph; idMap: Map<string, string> } => {
  const idMap = new Map<string, string>();

  for (const node of graph.nodes) {
    idMap.set(node.id, `${prefix}${node.id}`);
  }

  return {
    graph: {
      ...graph,
      edges: graph.edges.map((edge) => ({
        ...edge,
        id: `${prefix}${edge.id}`,
        source: idMap.get(edge.source) ?? edge.source,
        target: idMap.get(edge.target) ?? edge.target,
      })),
      nodes: graph.nodes.map((node) => {
        const newId = idMap.get(node.id) ?? node.id;
        const shallowPreviewOf = node.metadata?.shallowPreviewOf;
        const remappedShallowPreviewOf =
          typeof shallowPreviewOf === "string"
            ? (idMap.get(shallowPreviewOf) ?? shallowPreviewOf)
            : undefined;

        return {
          ...node,
          id: newId,
          metadata:
            remappedShallowPreviewOf !== undefined
              ? {
                  ...node.metadata,
                  shallowPreviewOf: remappedShallowPreviewOf,
                }
              : node.metadata,
        };
      }),
      rootNodeId: idMap.get(graph.rootNodeId) ?? graph.rootNodeId,
    },
    idMap,
  };
};

export interface MergeRouteChainOptions {
  route: string;
  layoutGraphs: PageLogicGraph[];
  pageGraph: PageLogicGraph;
}

const findLayoutChildrenSlot = (graph: PageLogicGraph): string | undefined =>
  graph.nodes.find(
    (node) => node.type === "slot" && node.metadata?.slotKind === "children"
  )?.id;

export const mergeRouteChainGraph = ({
  layoutGraphs,
  pageGraph,
  route,
}: MergeRouteChainOptions): PageLogicGraph => {
  const routeNodeId = `route:${route}`;
  const routeNode: LogicGraphNode = {
    filePath: pageGraph.entryFile,
    id: routeNodeId,
    label: route,
    metadata: { category: "ui" },
    type: "route",
  };

  const routeChain: RouteChainEntry[] = [
    {
      filePath: pageGraph.entryFile,
      kind: "route",
      label: route,
      nodeId: routeNodeId,
    },
  ];

  const mergedNodes: LogicGraphNode[] = [routeNode];
  const mergedEdges: PageLogicGraph["edges"] = [];
  const mergedFiles = [...pageGraph.files];
  const mergedWarnings = [...pageGraph.warnings];
  const filePaths = new Set(mergedFiles.map((file) => file.filePath));

  /** Where the next layout or page attaches (route, or a layout's {children} slot). */
  let attachParentId = routeNodeId;
  let attachFromRoute = true;

  for (let index = 0; index < layoutGraphs.length; index += 1) {
    const layoutGraph = layoutGraphs[index]!;
    const prefix = `chain:layout:${index}:`;
    const { graph: remapped } = remapGraph(layoutGraph, prefix);
    const layoutRootId = remapped.rootNodeId;
    const layoutRoot = remapped.nodes.find((node) => node.id === layoutRootId);
    const childrenSlotId = findLayoutChildrenSlot(remapped);

    mergedNodes.push(...remapped.nodes);
    mergedEdges.push(...remapped.edges);
    mergedEdges.push({
      id: `chain:edge:parent->layout:${index}`,
      label: attachFromRoute ? "wraps" : "children",
      source: attachParentId,
      target: layoutRootId,
      type: "renders",
    });

    for (const file of remapped.files) {
      if (!filePaths.has(file.filePath)) {
        filePaths.add(file.filePath);
        mergedFiles.push(file);
      }
    }
    mergedWarnings.push(...remapped.warnings);

    routeChain.push({
      filePath: layoutGraph.entryFile,
      kind: "layout",
      label: layoutRoot?.label ?? `Layout ${index + 1}`,
      nodeId: layoutRootId,
    });

    attachParentId = childrenSlotId ?? layoutRootId;
    attachFromRoute = false;
  }

  const pagePrefix = "chain:page:";
  const { graph: remappedPage } = remapGraph(pageGraph, pagePrefix);
  const pageRootId = remappedPage.rootNodeId;
  const pageRoot = remappedPage.nodes.find((node) => node.id === pageRootId);

  mergedNodes.push(...remappedPage.nodes);
  mergedEdges.push(...remappedPage.edges);
  mergedEdges.push({
    id: "chain:edge:parent->page",
    label: "children",
    source: attachParentId,
    target: pageRootId,
    type: "renders",
  });

  for (const file of remappedPage.files) {
    if (!filePaths.has(file.filePath)) {
      filePaths.add(file.filePath);
      mergedFiles.push(file);
    }
  }
  mergedWarnings.push(...remappedPage.warnings);

  routeChain.push({
    filePath: pageGraph.entryFile,
    kind: "page",
    label: pageRoot?.label ?? "Page",
    nodeId: pageRootId,
  });

  return {
    edges: mergedEdges,
    entryFile: pageGraph.entryFile,
    files: mergedFiles,
    nodes: mergedNodes,
    rootNodeId: routeNodeId,
    routeChain,
    warnings: mergedWarnings,
  };
};
