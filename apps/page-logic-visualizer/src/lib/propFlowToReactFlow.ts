import dagre from "@dagrejs/dagre";
import { MarkerType } from "@xyflow/react";
import type { Edge, Node } from "@xyflow/react";

import type { PropFlowNode } from "@/lib/propFlowGraph";
import {
  buildNestedPropFlowReactFlow,
  nestedNodeHeight,
  NESTED_NODE_WIDTH,
  NESTED_ORIGIN_X,
  NESTED_ORIGIN_Y,
} from "@/lib/propFlowNestedGraph";
import type { UsageFlowBranch, UsageFlowGraph } from "@/lib/propUsageFlow";
import { walkUsageFlowBranches } from "@/lib/propUsageFlow";

export const PROP_FLOW_NODE_WIDTH = 260;
export const PROP_FLOW_NODE_HEIGHT = 96;
export const PROP_FLOW_AWAIT_JOIN_HEIGHT = 52;
export const TRACED_NODE_PADDING = 20;

export interface PropFlowStepNodeData extends Record<string, unknown> {
  flowNode: PropFlowNode;
  focused: boolean;
  canTrace?: boolean;
  isTraced?: boolean;
  isNested?: boolean;
  parentFlowId?: string;
  onTraceToggle?: (nodeId: string) => void;
  onExpandAll?: (nodeId: string) => void;
  nestedHeight?: number;
  nestedWidth?: number;
  tracedNodeIds?: ReadonlySet<string>;
  /** Parent sized for children but children not mounted yet. */
  childrenPending?: boolean;
}

const ARROW = {
  height: 14,
  type: MarkerType.ArrowClosed,
  width: 14,
};

const edgeId = (source: string, target: string, suffix = "") =>
  `e:${source}->${target}${suffix}`;

export const readNodeWidth = (
  node: Pick<Node<PropFlowStepNodeData>, "width" | "measured" | "style">
): number =>
  node.measured?.width ??
  node.width ??
  (typeof node.style?.width === "number"
    ? node.style.width
    : PROP_FLOW_NODE_WIDTH);

export const readNodeHeight = (
  node: Pick<Node<PropFlowStepNodeData>, "height" | "measured" | "style">
): number =>
  node.measured?.height ??
  node.height ??
  (typeof node.style?.height === "number"
    ? node.style.height
    : PROP_FLOW_NODE_HEIGHT);

export const withDimensions = (
  node: Node<PropFlowStepNodeData>,
  width: number,
  height: number
): Node<PropFlowStepNodeData> => ({
  ...node,
  height,
  style: {
    ...node.style,
    height,
    width,
  },
  width,
});

const layoutSpineWithDagre = (
  spineNodes: Node<PropFlowStepNodeData>[],
  edges: Edge[]
): Node<PropFlowStepNodeData>[] => {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    marginx: 32,
    marginy: 32,
    nodesep: 56,
    rankdir: "TB",
    ranksep: 72,
  });

  for (const node of spineNodes) {
    graph.setNode(node.id, {
      height: readNodeHeight(node),
      width: readNodeWidth(node),
    });
  }

  for (const edge of edges) {
    if (graph.hasNode(edge.source) && graph.hasNode(edge.target)) {
      graph.setEdge(edge.source, edge.target);
    }
  }

  dagre.layout(graph);

  return spineNodes.map((node) => {
    const position = graph.node(node.id);
    const width = readNodeWidth(node);
    const height = readNodeHeight(node);
    return withDimensions(
      {
        ...node,
        position: {
          x: position.x - width / 2,
          y: position.y - height / 2,
        },
      },
      width,
      height
    );
  });
};

const pushEdge = (
  edges: Edge[],
  edgeIds: Set<string>,
  params: {
    source: string;
    target: string;
    suffix?: string;
    label?: string;
  }
) => {
  const id = edgeId(params.source, params.target, params.suffix);
  if (edgeIds.has(id)) {
    return;
  }
  edgeIds.add(id);
  edges.push({
    id,
    label: params.label,
    labelStyle: { fontSize: 9, fontWeight: 600 },
    markerEnd: ARROW,
    source: params.source,
    target: params.target,
    type: "smoothstep",
    zIndex: params.source.includes("::") ? 2 : 1,
  });
};

const computeParentBounds = (
  children: Node<PropFlowStepNodeData>[]
): { width: number; height: number; nestedHeight: number } => {
  if (children.length === 0) {
    return {
      height: PROP_FLOW_NODE_HEIGHT,
      nestedHeight: 0,
      width: PROP_FLOW_NODE_WIDTH,
    };
  }

  let maxRight = 0;
  let maxBottom = 0;

  for (const child of children) {
    const childWidth = readNodeWidth(child);
    const childHeight = readNodeHeight(child);
    maxRight = Math.max(maxRight, child.position.x + childWidth);
    maxBottom = Math.max(maxBottom, child.position.y + childHeight);
  }

  const nestedHeight = maxBottom + TRACED_NODE_PADDING;
  const width = Math.max(
    PROP_FLOW_NODE_WIDTH,
    maxRight + NESTED_ORIGIN_X + TRACED_NODE_PADDING
  );
  const height = Math.max(
    PROP_FLOW_NODE_HEIGHT,
    NESTED_ORIGIN_Y + nestedHeight
  );

  return { height, nestedHeight, width };
};

/** Main spine + subflow children (parentId) when traced. */
export const buildPropFlowReactFlow = (
  flowNodes: PropFlowNode[],
  focusedNodeId: string | null,
  tracedNodeIds: ReadonlySet<string> = new Set(),
  onTraceToggle?: (nodeId: string) => void,
  childrenReadyParents: ReadonlySet<string> = tracedNodeIds,
  onExpandAll?: (nodeId: string) => void
): { nodes: Node<PropFlowStepNodeData>[]; edges: Edge[] } => {
  const spineNodes: Node<PropFlowStepNodeData>[] = [];
  const childNodes: Node<PropFlowStepNodeData>[] = [];
  const edges: Edge[] = [];
  const edgeIds = new Set<string>();

  for (let index = 0; index < flowNodes.length; index++) {
    const flowNode = flowNodes[index]!;
    const isTraced = tracedNodeIds.has(flowNode.id);
    const canTrace = Boolean(
      flowNode.traceable && flowNode.expandableSteps?.length
    );

    let nestedHeight = 0;
    let nestedWidth = PROP_FLOW_NODE_WIDTH;
    let parentWidth = PROP_FLOW_NODE_WIDTH;
    let parentHeight = PROP_FLOW_NODE_HEIGHT;
    const tracedChildren: Node<PropFlowStepNodeData>[] = [];

    if (isTraced && flowNode.expandableSteps?.length) {
      const nested = buildNestedPropFlowReactFlow(
        flowNode.id,
        flowNode.expandableSteps,
        tracedNodeIds,
        onTraceToggle,
        onExpandAll
      );
      nestedWidth = nested.width;

      for (const child of nested.nodes) {
        const childHeight = nestedNodeHeight(child.data.flowNode.stepRole);
        tracedChildren.push(
          withDimensions(
            {
              ...child,
              draggable: true,
              extent: "parent",
              parentId: flowNode.id,
              position: {
                x: child.position.x + NESTED_ORIGIN_X,
                y: child.position.y + NESTED_ORIGIN_Y,
              },
              zIndex: 10,
            },
            NESTED_NODE_WIDTH,
            childHeight
          )
        );
      }

      const bounds = computeParentBounds(tracedChildren);
      ({ nestedHeight } = bounds);
      parentWidth = bounds.width;
      parentHeight = bounds.height;

      const showChildren = childrenReadyParents.has(flowNode.id);

      if (showChildren) {
        childNodes.push(...tracedChildren);

        for (const edge of nested.edges) {
          pushEdge(edges, edgeIds, {
            label: edge.label as string | undefined,
            source: edge.source,
            suffix: `:nested:${edge.id}`,
            target: edge.target,
          });
        }
      }
    }

    if (index > 0) {
      const prev = flowNodes[index - 1]!;
      pushEdge(edges, edgeIds, {
        label:
          flowNode.stepRole === "await-join"
            ? "await"
            : flowNode.transitionLabel,
        source: prev.id,
        suffix: ":seq",
        target: flowNode.id,
      });
    }

    spineNodes.push(
      withDimensions(
        {
          data: {
            canTrace,
            childrenPending: isTraced && !childrenReadyParents.has(flowNode.id),
            flowNode,
            focused: focusedNodeId === flowNode.id,
            isTraced,
            nestedHeight,
            nestedWidth,
            onExpandAll,
            onTraceToggle,
            tracedNodeIds,
          },
          draggable: true,
          id: flowNode.id,
          position: { x: 0, y: 0 },
          type: "propFlowStep",
          zIndex: isTraced ? 5 : 1,
        },
        parentWidth,
        parentHeight
      )
    );
  }

  const laidOutSpine = layoutSpineWithDagre(spineNodes, edges);

  return {
    edges,
    nodes: [...laidOutSpine, ...childNodes],
  };
};

/** Fan-out layout: one intake node, sibling usage branches (not a linear chain). */
export const buildWriterFlowReactFlow = (
  writerGraph: UsageFlowGraph,
  focusedNodeId: string | null
): { nodes: Node<PropFlowStepNodeData>[]; edges: Edge[] } => {
  const spineNodes: Node<PropFlowStepNodeData>[] = [];
  const edges: Edge[] = [];
  const edgeIds = new Set<string>();

  const pushFlowNode = (flowNode: PropFlowNode) => {
    if (spineNodes.some((node) => node.id === flowNode.id)) {
      return;
    }
    spineNodes.push(
      withDimensions(
        {
          data: {
            flowNode,
            focused: focusedNodeId === flowNode.id,
          },
          draggable: true,
          id: flowNode.id,
          position: { x: 0, y: 0 },
          type: "propFlowStep",
        },
        PROP_FLOW_NODE_WIDTH,
        PROP_FLOW_NODE_HEIGHT
      )
    );
  };

  pushFlowNode(writerGraph.intake);

  for (const branch of writerGraph.branches) {
    pushFlowNode(branch.node);
    pushEdge(edges, edgeIds, {
      label: branch.edgeLabel,
      source: branch.node.id,
      suffix: `:writer:${writerGraph.intake.id}`,
      target: writerGraph.intake.id,
    });
  }

  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    marginx: 32,
    marginy: 32,
    nodesep: 48,
    rankdir: "LR",
    ranksep: 88,
  });

  for (const node of spineNodes) {
    graph.setNode(node.id, {
      height: readNodeHeight(node),
      width: readNodeWidth(node),
    });
  }

  for (const edge of edges) {
    graph.setEdge(edge.source, edge.target);
  }

  dagre.layout(graph);

  const laidOut = spineNodes.map((node) => {
    const layout = graph.node(node.id);
    return {
      ...node,
      position: {
        x: layout.x - readNodeWidth(node) / 2,
        y: layout.y - readNodeHeight(node) / 2,
      },
    };
  });

  return { edges, nodes: laidOut };
};

export const buildUsageFlowReactFlow = (
  usageGraph: UsageFlowGraph,
  focusedNodeId: string | null
): { nodes: Node<PropFlowStepNodeData>[]; edges: Edge[] } => {
  const spineNodes: Node<PropFlowStepNodeData>[] = [];
  const edges: Edge[] = [];
  const edgeIds = new Set<string>();

  const pushFlowNode = (flowNode: PropFlowNode) => {
    if (spineNodes.some((node) => node.id === flowNode.id)) {
      return;
    }
    spineNodes.push(
      withDimensions(
        {
          data: {
            flowNode,
            focused: focusedNodeId === flowNode.id,
          },
          draggable: true,
          id: flowNode.id,
          position: { x: 0, y: 0 },
          type: "propFlowStep",
        },
        PROP_FLOW_NODE_WIDTH,
        PROP_FLOW_NODE_HEIGHT
      )
    );
  };

  pushFlowNode(usageGraph.intake);

  const connectBranchTree = (parentId: string, items: UsageFlowBranch[]) => {
    for (const item of items) {
      pushFlowNode(item.node);
      pushEdge(edges, edgeIds, {
        label: item.edgeLabel,
        source: parentId,
        suffix: `:usage:${item.node.id}`,
        target: item.node.id,
      });
      if (item.children?.length) {
        connectBranchTree(item.node.id, item.children);
      }
    }
  };

  for (const branch of usageGraph.branches) {
    pushFlowNode(branch.node);
    pushEdge(edges, edgeIds, {
      label: branch.edgeLabel,
      source: usageGraph.intake.id,
      suffix: `:usage:${branch.node.id}`,
      target: branch.node.id,
    });
    connectBranchTree(branch.node.id, branch.children ?? []);
  }

  return {
    edges,
    nodes: layoutSpineWithDagre(spineNodes, edges),
  };
};
