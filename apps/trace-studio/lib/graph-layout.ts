import type { Edge, Node } from "@xyflow/react";

export const NODE_MIN_WIDTH = 140;
export const NODE_MAX_WIDTH = 300;
export const NODE_WIDTH = 176;
export const NODE_HEIGHT = 72;
export const NODE_LINE_HEIGHT = 17;

/** Edge types that define the composition tree. */
export const STRUCTURAL_EDGE_TYPES = new Set([
  "routes_to",
  "wraps",
  "shows_loading",
  "shows_error",
  "shows_not_found",
  "renders",
  "uses_hook",
  "calls",
  "passes_prop",
  "prop_source",
  "sequence",
]);

const DEPTH_GAP = 36;
const SIBLING_GAP = 24;
const ORPHAN_GAP = 16;
const ORPHAN_SECTION_GAP = 28;
const MAX_NODES_PER_ROW = 4;

/** Edge types that define parent → child links for tree layout. */
const LAYOUT_EDGE_TYPES = new Set([
  "routes_to",
  "wraps",
  "shows_loading",
  "shows_error",
  "shows_not_found",
  "renders",
  "passes_prop",
  "uses_hook",
  "calls",
  "sequence",
]);

const LAYOUT_EDGE_PRIORITY: Record<string, number> = {
  calls: 4,
  passes_prop: 3,
  renders: 2,
  routes_to: 0,
  sequence: 6,
  shows_error: 5,
  shows_loading: 5,
  shows_not_found: 5,
  uses_hook: 3,
  wraps: 1,
};

/** Tier stride: one depth level in the vertical layout. */
export const SWIMLANE_HEIGHT = NODE_HEIGHT + DEPTH_GAP;

/** Size node box from label so full text fits (no ellipsis). */
export function measureTraceNodeDimensions(
  label: string,
  nodeType: string
): { width: number; height: number } {
  const typeLine = 14;
  const paddingY = 18;
  const paddingX = 16;
  const charWidth = 7.1;
  const width = Math.min(
    NODE_MAX_WIDTH,
    Math.max(NODE_MIN_WIDTH, Math.ceil(label.length * charWidth) + paddingX)
  );
  const charsPerLine = Math.max(8, Math.floor((width - paddingX) / charWidth));
  const labelLines = Math.max(1, Math.ceil(label.length / charsPerLine));
  const height = Math.max(
    NODE_HEIGHT,
    paddingY + labelLines * NODE_LINE_HEIGHT + typeLine
  );

  void nodeType;
  return { height, width };
}

function nodeWidth(node: Node): number {
  const measured = node.width ?? node.measured?.width ?? NODE_WIDTH;
  return Math.max(NODE_MIN_WIDTH, measured);
}

function nodeHeight(node: Node): number {
  const measured = node.height ?? node.measured?.height ?? NODE_HEIGHT;
  return Math.max(NODE_HEIGHT, measured);
}

type LayoutDirection = "LR" | "TB";

export interface LayerBand {
  index: number;
  label: string;
  y: number;
  height: number;
}

export interface HierarchicalLayoutResult {
  nodes: Node[];
  layers: LayerBand[];
}

export interface HierarchicalLayoutOptions {
  centerId?: string;
  maxNodesPerRow?: number;
}

export function filterStructuralEdges(edges: Edge[]): Edge[] {
  const seen = new Set<string>();

  return edges.flatMap((edge) => {
    const edgeType =
      typeof edge.label === "string"
        ? edge.label.replaceAll(" ", "_")
        : String(edge.data?.edgeType ?? "");

    const normalizedType = edgeType.includes("routes")
      ? "routes_to"
      : edgeType.includes("uses")
        ? "uses_hook"
        : edgeType;

    if (!STRUCTURAL_EDGE_TYPES.has(normalizedType)) {
      return [];
    }

    const key = `${edge.source}->${edge.target}:${normalizedType}`;
    if (seen.has(key)) {
      return [];
    }
    seen.add(key);

    return [edge];
  });
}

export function filterStructuralTraceEdges<
  T extends { from: string; to: string; type: string },
>(edges: T[]): T[] {
  const seen = new Set<string>();

  return edges.filter((edge) => {
    if (!STRUCTURAL_EDGE_TYPES.has(edge.type)) {
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

function sequenceReachableFrom<
  T extends { from: string; to: string; type: string },
>(from: string, edges: T[]): Set<string> {
  const reachable = new Set<string>();
  const queue = [from];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    for (const edge of edges) {
      if (edge.type !== "sequence" || edge.from !== current) {
        continue;
      }

      if (!reachable.has(edge.to)) {
        reachable.add(edge.to);
        queue.push(edge.to);
      }
    }
  }

  return reachable;
}

export function filterLayoutTraceEdges<
  T extends { from: string; to: string; type: string },
>(edges: T[]): T[] {
  const hasSequence = edges.some((edge) => edge.type === "sequence");
  if (!hasSequence) {
    return filterStructuralTraceEdges(edges);
  }

  const sequenceEdges = edges.filter((edge) => edge.type === "sequence");
  const reachableCache = new Map<string, Set<string>>();

  const reachableFrom = (from: string): Set<string> => {
    const cached = reachableCache.get(from);
    if (cached) {
      return cached;
    }

    const set = sequenceReachableFrom(from, sequenceEdges);
    reachableCache.set(from, set);
    return set;
  };

  const seen = new Set<string>();

  return edges.filter((edge) => {
    if (!STRUCTURAL_EDGE_TYPES.has(edge.type)) {
      return false;
    }

    if (
      (edge.type === "calls" || edge.type === "renders") &&
      reachableFrom(edge.from).has(edge.to)
    ) {
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

function edgeTypeFromFlowEdge(edge: Edge): string {
  if (typeof edge.label === "string") {
    return edge.label.replaceAll(" ", "_");
  }

  return String(edge.data?.edgeType ?? "");
}

function edgesForDagreLayout(edges: Edge[]): Edge[] {
  const bestByPair = new Map<string, Edge>();

  for (const edge of edges) {
    const edgeType = edgeTypeFromFlowEdge(edge);
    if (!LAYOUT_EDGE_TYPES.has(edgeType)) {
      continue;
    }

    const key = `${edge.source}->${edge.target}`;
    const existing = bestByPair.get(key);
    if (!existing) {
      bestByPair.set(key, edge);
      continue;
    }

    const existingType = edgeTypeFromFlowEdge(existing);
    const existingPriority = LAYOUT_EDGE_PRIORITY[existingType] ?? 99;
    const nextPriority = LAYOUT_EDGE_PRIORITY[edgeType] ?? 99;
    if (nextPriority < existingPriority) {
      bestByPair.set(key, edge);
    }
  }

  return [...bestByPair.values()];
}

function bfsComponentSize(
  startId: string,
  adjacency: Map<string, Set<string>>
): number {
  const visited = new Set<string>();
  const queue = [startId];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) {
      continue;
    }

    visited.add(current);
    for (const next of adjacency.get(current) ?? []) {
      if (!visited.has(next)) {
        queue.push(next);
      }
    }
  }

  return visited.size;
}

function connectedComponentIds(
  anchorId: string | undefined,
  nodeIds: Set<string>,
  edges: Edge[]
): Set<string> {
  const adjacency = new Map<string, Set<string>>();

  for (const id of nodeIds) {
    adjacency.set(id, new Set());
  }

  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      continue;
    }

    adjacency.get(edge.source)!.add(edge.target);
    adjacency.get(edge.target)!.add(edge.source);
  }

  let startId = anchorId && nodeIds.has(anchorId) ? anchorId : undefined;

  if (!startId) {
    let largest = 0;
    for (const id of nodeIds) {
      const size = bfsComponentSize(id, adjacency);
      if (size > largest) {
        largest = size;
        startId = id;
      }
    }
  }

  if (!startId) {
    return new Set();
  }

  const visited = new Set<string>();
  const queue = [startId];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) {
      continue;
    }

    visited.add(current);
    for (const next of adjacency.get(current) ?? []) {
      if (!visited.has(next)) {
        queue.push(next);
      }
    }
  }

  return visited;
}

function buildChildrenMap(edges: Edge[]): Map<string, string[]> {
  const children = new Map<string, string[]>();

  for (const edge of edges) {
    const bucket = children.get(edge.source) ?? [];
    bucket.push(edge.target);
    children.set(edge.source, bucket);
  }

  for (const [key, value] of children) {
    children.set(key, [...new Set(value)]);
  }

  return children;
}

function buildParentsMap(edges: Edge[]): Map<string, string[]> {
  const parents = new Map<string, string[]>();

  for (const edge of edges) {
    const bucket = parents.get(edge.target) ?? [];
    bucket.push(edge.source);
    parents.set(edge.target, bucket);
  }

  return parents;
}

function nodeTypePriority(node: Node): number {
  const type = String(node.data?.nodeType ?? "");
  const order: Record<string, number> = {
    component: 4,
    error: 3,
    function: 6,
    hook: 5,
    layout: 1,
    loading: 3,
    not_found: 3,
    page: 2,
    route: 0,
  };

  return order[type] ?? 7;
}

function sortNodeIds(ids: string[], nodesById: Map<string, Node>): string[] {
  return [...ids].toSorted((left, right) => {
    const leftNode = nodesById.get(left);
    const rightNode = nodesById.get(right);
    return (
      nodeTypePriority(leftNode ?? ({ data: {} } as Node)) -
        nodeTypePriority(rightNode ?? ({ data: {} } as Node)) ||
      left.localeCompare(right)
    );
  });
}

function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    rows.push(items.slice(index, index + size));
  }
  return rows;
}

function yForDepth(depth: number): number {
  return depth * SWIMLANE_HEIGHT;
}

interface SubtreeLayoutState {
  layers: Map<string, number>;
  positions: Map<string, { x: number; y: number }>;
}

interface SubtreeMetrics {
  bottom: number;
  width: number;
}

/**
 * Classic tree layout: parent on top, children spread horizontally per row
 * (wraps to the next row when there are many siblings).
 */
function layoutSubtree(
  nodeId: string,
  depth: number,
  xCursor: number,
  nodesById: Map<string, Node>,
  children: Map<string, string[]>,
  state: SubtreeLayoutState
): SubtreeMetrics {
  const node = nodesById.get(nodeId);
  if (!node) {
    return { bottom: yForDepth(depth), width: 0 };
  }

  const childIds = sortNodeIds(children.get(nodeId) ?? [], nodesById);
  const nodeW = nodeWidth(node);
  const nodeH = nodeHeight(node);

  state.layers.set(nodeId, depth);

  if (childIds.length === 0) {
    state.positions.set(nodeId, { x: xCursor, y: yForDepth(depth) });
    return { bottom: yForDepth(depth) + nodeH, width: nodeW };
  }

  const childRows = chunk(childIds, MAX_NODES_PER_ROW);
  let subtreeWidth = 0;
  let maxChildBottom = yForDepth(depth + 1);

  for (let rowIndex = 0; rowIndex < childRows.length; rowIndex += 1) {
    const rowIds = childRows[rowIndex]!;
    const childDepth = depth + 1 + rowIndex;
    let rowCursor = xCursor;
    let rowWidth = 0;

    for (const childId of rowIds) {
      const metrics = layoutSubtree(
        childId,
        childDepth,
        rowCursor,
        nodesById,
        children,
        state
      );
      const step = Math.max(metrics.width, NODE_MIN_WIDTH) + SIBLING_GAP;
      rowWidth += step;
      rowCursor += step;
      maxChildBottom = Math.max(maxChildBottom, metrics.bottom);
    }

    rowWidth = Math.max(0, rowWidth - SIBLING_GAP);
    subtreeWidth = Math.max(subtreeWidth, rowWidth);
  }

  const parentX = xCursor + (Math.max(nodeW, subtreeWidth) - nodeW) / 2;

  state.positions.set(nodeId, {
    x: parentX,
    y: yForDepth(depth),
  });

  return {
    bottom: maxChildBottom,
    width: Math.max(nodeW, subtreeWidth),
  };
}

/** Push apart nodes that share a layer but overlap on X. */
function resolveHorizontalOverlaps(nodes: Node[]): Node[] {
  const byLayer = new Map<number, Node[]>();

  for (const node of nodes) {
    const layer = (node.data?.layer as number | undefined) ?? 0;
    const bucket = byLayer.get(layer) ?? [];
    bucket.push(node);
    byLayer.set(layer, bucket);
  }

  const positions = new Map(
    nodes.map((node) => [node.id, { ...node.position }])
  );

  for (const layerNodes of byLayer.values()) {
    const sorted = [...layerNodes].toSorted(
      (left, right) => left.position.x - right.position.x
    );

    let cursor = Number.NEGATIVE_INFINITY;
    for (const node of sorted) {
      const position = positions.get(node.id)!;
      const width = nodeWidth(node);
      const nextX = Math.max(
        position.x,
        cursor + (cursor > -Infinity ? SIBLING_GAP : 0)
      );
      position.x = nextX;
      cursor = nextX + width;
    }
  }

  return nodes.map((node) => ({
    ...node,
    position: positions.get(node.id) ?? node.position,
  }));
}

function graphBounds(nodes: Node[]): {
  centerX: number;
  maxY: number;
} {
  if (nodes.length === 0) {
    return { centerX: 0, maxY: 0 };
  }

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = 0;

  for (const node of nodes) {
    const width = nodeWidth(node);
    const height = nodeHeight(node);
    minX = Math.min(minX, node.position.x);
    maxX = Math.max(maxX, node.position.x + width);
    maxY = Math.max(maxY, node.position.y + height);
  }

  return {
    centerX: (minX + maxX) / 2,
    maxY,
  };
}

/** Nodes without tree edges — spread in horizontal rows. */
function layoutGridNodes(
  nodes: Node[],
  startY: number,
  centerX: number,
  layerStart = 900
): Node[] {
  const rows = chunk(nodes, MAX_NODES_PER_ROW);
  let y = startY;
  let layer = layerStart;
  const positioned: Node[] = [];

  for (const row of rows) {
    const rowWidth = row.reduce(
      (sum, node, index) =>
        sum + nodeWidth(node) + (index > 0 ? ORPHAN_GAP : 0),
      0
    );
    let x = centerX - rowWidth / 2;
    let rowHeight = 0;

    for (const node of row) {
      const width = nodeWidth(node);
      const height = nodeHeight(node);
      rowHeight = Math.max(rowHeight, height);
      positioned.push({
        ...node,
        data: { ...node.data, layer },
        position: { x, y },
      });
      x += width + ORPHAN_GAP;
      layer += 1;
    }

    y += rowHeight + ORPHAN_GAP;
  }

  return positioned;
}

function layoutOrphanNodes(nodes: Node[], centerId?: string): Node[] {
  const center = centerId ? nodes.find((n) => n.id === centerId) : undefined;
  const others = nodes.filter((n) => n.id !== centerId);
  const ordered = center ? [center, ...others] : nodes;

  return layoutGridNodes(ordered, 0, 0, 0);
}

export function layoutHierarchicalNodes(
  nodes: Node[],
  edges: Edge[],
  options: HierarchicalLayoutOptions = {}
): HierarchicalLayoutResult {
  if (nodes.length === 0) {
    return { layers: [], nodes: [] };
  }

  const structuralEdges = filterStructuralEdges(edges);
  const layoutEdges = edgesForDagreLayout(structuralEdges);
  const nodeIds = new Set(nodes.map((node) => node.id));

  if (layoutEdges.length === 0) {
    return {
      layers: [],
      nodes: layoutOrphanNodes(nodes, options.centerId),
    };
  }

  const connectedIds = connectedComponentIds(
    options.centerId,
    nodeIds,
    layoutEdges
  );

  const mainNodes = nodes.filter((node) => connectedIds.has(node.id));
  const detachedNodes = nodes.filter((node) => !connectedIds.has(node.id));

  const mainEdges = layoutEdges.filter(
    (edge) => connectedIds.has(edge.source) && connectedIds.has(edge.target)
  );

  const nodesById = new Map(mainNodes.map((node) => [node.id, node]));
  const children = buildChildrenMap(mainEdges);
  const parents = buildParentsMap(mainEdges);

  let roots = mainNodes
    .filter((node) => (parents.get(node.id)?.length ?? 0) === 0)
    .map((node) => node.id);

  roots = sortNodeIds(roots, nodesById);

  if (
    roots.length === 0 &&
    options.centerId &&
    connectedIds.has(options.centerId)
  ) {
    roots = [options.centerId];
  }

  const state: SubtreeLayoutState = {
    layers: new Map(),
    positions: new Map(),
  };

  let xCursor = 0;
  for (const rootId of roots) {
    const metrics = layoutSubtree(
      rootId,
      0,
      xCursor,
      nodesById,
      children,
      state
    );
    xCursor += metrics.width + SIBLING_GAP;
  }

  const unpositioned = mainNodes.filter(
    (node) => !state.positions.has(node.id)
  );

  let positioned: Node[] = mainNodes
    .filter((node) => state.positions.has(node.id))
    .map((node) => {
      const layer = state.layers.get(node.id) ?? 0;
      return {
        ...node,
        data: { ...node.data, layer },
        position: state.positions.get(node.id)!,
      };
    });

  if (unpositioned.length > 0) {
    const { centerX, maxY } = graphBounds(positioned);
    positioned = [
      ...positioned,
      ...layoutGridNodes(
        unpositioned,
        positioned.length > 0 ? maxY + ORPHAN_SECTION_GAP : 0,
        positioned.length > 0 ? centerX : 0,
        50
      ),
    ];
  }

  positioned = resolveHorizontalOverlaps(positioned);

  if (detachedNodes.length > 0) {
    const { centerX, maxY } = graphBounds(positioned);
    positioned = [
      ...positioned,
      ...layoutGridNodes(detachedNodes, maxY + ORPHAN_SECTION_GAP, centerX),
    ];
    positioned = resolveHorizontalOverlaps(positioned);
  }

  const layers: LayerBand[] = [];
  const depthsPresent = [
    ...new Set(positioned.map((node) => node.data?.layer as number)),
  ].toSorted((a, b) => a - b);

  for (const depth of depthsPresent) {
    const bandNodes = positioned.filter((node) => node.data?.layer === depth);
    const minY = Math.min(...bandNodes.map((node) => node.position.y));
    const maxY = Math.max(
      ...bandNodes.map((node) => node.position.y + nodeHeight(node))
    );
    layers.push({
      height: maxY - minY,
      index: depth,
      label: `Level ${depth + 1}`,
      y: minY,
    });
  }

  return { layers, nodes: positioned };
}

/** @deprecated Use layoutHierarchicalNodes for trace graphs. */
export function layoutGraphNodes(
  nodes: Node[],
  edges: Edge[],
  options: { centerId?: string; direction?: LayoutDirection } = {}
): Node[] {
  const direction = options.direction ?? "TB";

  if (direction === "TB") {
    return layoutHierarchicalNodes(nodes, edges, options).nodes;
  }

  if (nodes.length === 0) {
    return [];
  }

  if (edges.length === 0) {
    return layoutOrphanNodes(nodes, options.centerId);
  }

  return layoutHierarchicalNodes(nodes, edges, options).nodes;
}
