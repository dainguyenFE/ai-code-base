import type { LogicGraphEdge, LogicGraphNode, PageLogicGraph } from "../types";

export interface MergeGraphOptions {
  base: PageLogicGraph;
  expansion: PageLogicGraph;
  anchorNodeId: string;
}

const remapId = (prefix: string, id: string): string => `${prefix}${id}`;

const UI_CHILD_EDGE_TYPES = new Set([
  "renders",
  "condition-true",
  "condition-false",
  "loop-renders",
]);

const matchesShallowPreviewAnchor = (
  shallowPreviewOf: string,
  anchorNodeId: string
): boolean =>
  shallowPreviewOf === anchorNodeId || anchorNodeId.endsWith(shallowPreviewOf);

const collectShallowPreviewNodeIds = (
  graph: PageLogicGraph,
  anchorNodeId: string
): Set<string> => {
  const removeIds = new Set<string>();
  for (const node of graph.nodes) {
    const shallowPreviewOf = node.metadata?.shallowPreviewOf;
    if (
      typeof shallowPreviewOf === "string" &&
      matchesShallowPreviewAnchor(shallowPreviewOf, anchorNodeId)
    ) {
      removeIds.add(node.id);
    }
  }

  let added = true;
  while (added) {
    added = false;
    for (const edge of graph.edges) {
      if (
        !UI_CHILD_EDGE_TYPES.has(edge.type) ||
        !removeIds.has(edge.source) ||
        removeIds.has(edge.target)
      ) {
        continue;
      }
      const target = graph.nodes.find((node) => node.id === edge.target);
      if (target?.metadata?.shallowPreview === true) {
        removeIds.add(edge.target);
        added = true;
      }
    }
  }

  return removeIds;
};

export const mergeGraphExpansion = ({
  base,
  expansion,
  anchorNodeId,
}: MergeGraphOptions): PageLogicGraph => {
  const prefix = `exp:${anchorNodeId}:`;
  const idMap = new Map<string, string>();
  const shallowPreviewIds = collectShallowPreviewNodeIds(base, anchorNodeId);

  for (const node of expansion.nodes) {
    if (node.id === expansion.rootNodeId) {
      idMap.set(node.id, anchorNodeId);
      continue;
    }
    idMap.set(node.id, remapId(prefix, node.id));
  }

  const existingIds = new Set(
    base.nodes
      .filter((node) => !shallowPreviewIds.has(node.id))
      .map((node) => node.id)
  );
  const newNodes: LogicGraphNode[] = base.nodes.filter(
    (node) => !shallowPreviewIds.has(node.id)
  );
  const newEdges: LogicGraphEdge[] = base.edges.filter(
    (edge) =>
      !shallowPreviewIds.has(edge.source) && !shallowPreviewIds.has(edge.target)
  );
  const expandedAnchors = new Set(
    base.nodes
      .filter((node) => node.metadata?.expanded === true)
      .map((node) => node.id)
  );
  expandedAnchors.add(anchorNodeId);

  for (const node of base.nodes) {
    if (node.id === anchorNodeId) {
      const index = newNodes.findIndex((item) => item.id === anchorNodeId);
      if (index !== -1) {
        newNodes[index] = {
          ...node,
          metadata: {
            ...node.metadata,
            expandable: node.filePath ? true : node.metadata?.expandable,
            expanded: true,
          },
        };
      }
    }
  }

  for (const node of expansion.nodes) {
    if (node.id === expansion.rootNodeId) {
      continue;
    }
    const mappedId = idMap.get(node.id);
    if (!mappedId || existingIds.has(mappedId)) {
      continue;
    }
    existingIds.add(mappedId);
    newNodes.push({
      ...node,
      id: mappedId,
      metadata: {
        ...node.metadata,
        expandedFrom: anchorNodeId,
      },
    });
  }

  let edgeCounter = base.edges.length;
  for (const edge of expansion.edges) {
    const source = idMap.get(edge.source);
    const target = idMap.get(edge.target);
    if (!source || !target) {
      continue;
    }

    edgeCounter += 1;
    newEdges.push({
      ...edge,
      id: `${prefix}edge:${edgeCounter}`,
      source,
      target,
    });
  }

  const filePaths = new Set(base.files.map((file) => file.filePath));
  const mergedFiles = [
    ...base.files,
    ...expansion.files.filter((file) => !filePaths.has(file.filePath)),
  ];

  return {
    ...base,
    edges: newEdges,
    files: mergedFiles,
    nodes: newNodes,
    warnings: [...base.warnings, ...expansion.warnings],
  };
};

export const isNodeExpandable = (node: LogicGraphNode): boolean => {
  if (
    node.type !== "component" &&
    node.type !== "page" &&
    node.type !== "hook"
  ) {
    return false;
  }
  if (node.metadata?.isHtml === true) {
    return false;
  }
  if (node.metadata?.expanded === true) {
    return false;
  }
  return Boolean(node.filePath);
};

const expansionPrefix = (anchorNodeId: string): string =>
  `exp:${anchorNodeId}:`;

export const collapseGraphExpansion = (
  graph: PageLogicGraph,
  anchorNodeId: string
): PageLogicGraph => {
  const prefix = expansionPrefix(anchorNodeId);

  return {
    ...graph,
    edges: graph.edges.filter((edge) => !edge.id.startsWith(prefix)),
    nodes: graph.nodes
      .filter((node) => !node.id.startsWith(prefix))
      .map((node) =>
        node.id === anchorNodeId
          ? {
              ...node,
              metadata: {
                ...node.metadata,
                expanded: false,
              },
            }
          : node
      ),
  };
};
