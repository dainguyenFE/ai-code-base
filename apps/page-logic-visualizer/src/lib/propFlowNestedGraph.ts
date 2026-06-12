import dagre from "@dagrejs/dagre";
import { MarkerType } from "@xyflow/react";
import type { Edge, Node } from "@xyflow/react";

import type { PropFlowNode } from "@/lib/propFlowGraph";
import type { PropFlowStepNodeData } from "@/lib/propFlowToReactFlow";
import {
  PROP_FLOW_AWAIT_JOIN_HEIGHT,
  PROP_FLOW_NODE_HEIGHT,
  PROP_FLOW_NODE_WIDTH,
} from "@/lib/propFlowToReactFlow";

export const NESTED_NODE_WIDTH = 220;
const NESTED_STEP_HEIGHT = 72;
const NESTED_AWAIT_JOIN_HEIGHT = 44;

export const NESTED_ORIGIN_X = 12;
export const NESTED_ORIGIN_Y = 88;

export const nestedNodeHeight = (stepRole?: string): number =>
  stepRole === "await-join" ? NESTED_AWAIT_JOIN_HEIGHT : NESTED_STEP_HEIGHT;

const ARROW = {
  height: 10,
  type: MarkerType.ArrowClosed,
  width: 10,
};

const prefixId = (parentId: string, id: string) => `${parentId}::${id}`;

const edgeId = (source: string, target: string, suffix = "") =>
  `e:${source}->${target}${suffix}`;

const branchEdgeLabel = (branchKind: string): string => {
  switch (branchKind) {
    case "try": {
      return "try";
    }
    case "catch": {
      return "catch";
    }
    case "if-true": {
      return "then";
    }
    case "if-false": {
      return "else";
    }
    default: {
      return branchKind;
    }
  }
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
    labelStyle: { fontSize: 8, fontWeight: 600 },
    markerEnd: ARROW,
    source: params.source,
    target: params.target,
    type: "smoothstep",
  });
};

const pushNestedNode = (
  flowNode: PropFlowNode,
  parentId: string,
  nodes: Node<PropFlowStepNodeData>[],
  tracedNodeIds: ReadonlySet<string>,
  onTraceToggle?: (nodeId: string) => void,
  onExpandAll?: (nodeId: string) => void
) => {
  const id = prefixId(parentId, flowNode.id);
  if (nodes.some((node) => node.id === id)) {
    return;
  }

  const canTrace = Boolean(
    flowNode.traceable && flowNode.expandableSteps?.length
  );

  nodes.push({
    data: {
      canTrace,
      flowNode,
      focused: false,
      isNested: true,
      isTraced: tracedNodeIds.has(flowNode.id),
      onExpandAll,
      onTraceToggle,
      parentFlowId: parentId,
    },
    id,
    position: { x: 0, y: 0 },
    type: "propFlowStep",
  });
};

const appendBranchSteps = (
  parentId: string,
  branchSteps: PropFlowNode[],
  entrySourceIds: string[],
  branchIndex: number,
  branchKind: string,
  nodes: Node<PropFlowStepNodeData>[],
  edges: Edge[],
  edgeIds: Set<string>,
  tracedNodeIds: ReadonlySet<string>,
  onTraceToggle?: (nodeId: string) => void,
  onExpandAll?: (nodeId: string) => void
): string[] => {
  let previousIds = entrySourceIds;
  let leaves: string[] = [];

  branchSteps.forEach((step, stepIndex) => {
    const targetId = prefixId(parentId, step.id);

    if (stepIndex === 0 && entrySourceIds.length > 0) {
      for (const sourceId of entrySourceIds) {
        pushEdge(edges, edgeIds, {
          label: branchEdgeLabel(branchKind),
          source: sourceId,
          suffix: `:br${branchIndex}:entry`,
          target: targetId,
        });
      }
    } else if (stepIndex > 0) {
      for (const sourceId of previousIds) {
        pushEdge(edges, edgeIds, {
          label: step.transitionLabel,
          source: sourceId,
          suffix: `:br${branchIndex}`,
          target: targetId,
        });
      }
    }

    leaves = appendNestedFlowNode(
      parentId,
      step,
      nodes,
      edges,
      edgeIds,
      tracedNodeIds,
      onTraceToggle,
      onExpandAll
    );
    previousIds = leaves;
  });

  return leaves;
};

const appendNestedFlowNode = (
  parentId: string,
  flowNode: PropFlowNode,
  nodes: Node<PropFlowStepNodeData>[],
  edges: Edge[],
  edgeIds: Set<string>,
  tracedNodeIds: ReadonlySet<string>,
  onTraceToggle?: (nodeId: string) => void,
  onExpandAll?: (nodeId: string) => void
): string[] => {
  const nodeId = prefixId(parentId, flowNode.id);

  if (flowNode.branchGroup) {
    pushNestedNode(
      flowNode,
      parentId,
      nodes,
      tracedNodeIds,
      onTraceToggle,
      onExpandAll
    );
    const branchLeaves: string[] = [];

    flowNode.branchGroup.branches.forEach((branch, branchIndex) => {
      branchLeaves.push(
        ...appendBranchSteps(
          parentId,
          branch.steps,
          [nodeId],
          branchIndex,
          branch.branchKind,
          nodes,
          edges,
          edgeIds,
          tracedNodeIds,
          onTraceToggle,
          onExpandAll
        )
      );
    });

    return branchLeaves.length > 0 ? branchLeaves : [nodeId];
  }

  pushNestedNode(
    flowNode,
    parentId,
    nodes,
    tracedNodeIds,
    onTraceToggle,
    onExpandAll
  );

  if (flowNode.parallelGroup) {
    const branchLeaves: string[] = [];

    flowNode.parallelGroup.branches.forEach((branch, branchIndex) => {
      const callStep = branch.steps[0];
      if (!callStep) {
        return;
      }

      const callId = prefixId(parentId, callStep.id);
      pushEdge(edges, edgeIds, {
        label: "fork",
        source: nodeId,
        suffix: `:fork:${branchIndex}`,
        target: callId,
      });

      branchLeaves.push(
        ...appendNestedFlowNode(
          parentId,
          callStep,
          nodes,
          edges,
          edgeIds,
          tracedNodeIds,
          onTraceToggle,
          onExpandAll
        )
      );
    });

    return branchLeaves.length > 0 ? branchLeaves : [nodeId];
  }

  if (flowNode.stepRole === "await-join") {
    return [nodeId];
  }

  let leaves = [nodeId];

  if (flowNode.nestedSteps?.length) {
    for (const nested of flowNode.nestedSteps) {
      const nestedId = prefixId(parentId, nested.id);
      for (const sourceId of leaves) {
        pushEdge(edges, edgeIds, {
          label: nested.transitionLabel,
          source: sourceId,
          target: nestedId,
        });
      }
      leaves = appendNestedFlowNode(
        parentId,
        nested,
        nodes,
        edges,
        edgeIds,
        tracedNodeIds,
        onTraceToggle,
        onExpandAll
      );
    }
  }

  if (tracedNodeIds.has(flowNode.id) && flowNode.expandableSteps?.length) {
    for (const step of flowNode.expandableSteps) {
      if (step.branchGroup) {
        const branchLeaves: string[] = [];
        step.branchGroup.branches.forEach((branch, branchIndex) => {
          branchLeaves.push(
            ...appendBranchSteps(
              parentId,
              branch.steps,
              leaves,
              branchIndex,
              branch.branchKind,
              nodes,
              edges,
              edgeIds,
              tracedNodeIds,
              onTraceToggle,
              onExpandAll
            )
          );
        });
        leaves = branchLeaves.length > 0 ? branchLeaves : leaves;
        continue;
      }

      const stepId = prefixId(parentId, step.id);
      for (const sourceId of leaves) {
        pushEdge(edges, edgeIds, {
          label: step.transitionLabel ?? "enter",
          source: sourceId,
          suffix: ":inner",
          target: stepId,
        });
      }
      leaves = appendNestedFlowNode(
        parentId,
        step,
        nodes,
        edges,
        edgeIds,
        tracedNodeIds,
        onTraceToggle,
        onExpandAll
      );
    }
  }

  return leaves;
};

const layoutNested = (
  nodes: Node<PropFlowStepNodeData>[],
  edges: Edge[]
): { nodes: Node<PropFlowStepNodeData>[]; edges: Edge[]; height: number } => {
  if (nodes.length === 0) {
    return { edges, height: 0, nodes };
  }

  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    marginx: 16,
    marginy: 16,
    nodesep: 64,
    rankdir: "TB",
    ranksep: 64,
  });

  for (const node of nodes) {
    const role = node.data.flowNode.stepRole;
    const height =
      role === "await-join" ? NESTED_AWAIT_JOIN_HEIGHT : NESTED_STEP_HEIGHT;
    graph.setNode(node.id, { height, width: NESTED_NODE_WIDTH });
  }

  for (const edge of edges) {
    graph.setEdge(edge.source, edge.target);
  }

  dagre.layout(graph);

  let minX = Infinity;
  let minY = Infinity;
  const positioned = nodes.map((node) => {
    const position = graph.node(node.id);
    const role = node.data.flowNode.stepRole;
    const height = nestedNodeHeight(role);
    const x = position?.x != null ? position.x - NESTED_NODE_WIDTH / 2 : 0;
    const y = position?.y != null ? position.y - height / 2 : 0;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    return { height, node, x, y };
  });

  if (!Number.isFinite(minX)) {
    minX = 0;
  }
  if (!Number.isFinite(minY)) {
    minY = 0;
  }

  let maxBottom = 0;
  let maxRight = 0;
  const layoutNodes = positioned.map(({ node, x, y, height }) => {
    const normalizedX = x - minX + 8;
    const normalizedY = y - minY + 8;
    maxBottom = Math.max(maxBottom, normalizedY + height);
    maxRight = Math.max(maxRight, normalizedX + NESTED_NODE_WIDTH);
    return {
      ...node,
      position: {
        x: normalizedX,
        y: normalizedY,
      },
      style: {
        height,
        width: NESTED_NODE_WIDTH,
      },
    };
  });

  return {
    edges,
    height: maxBottom + 16,
    nodes: layoutNodes,
  };
};

/** Body graph rendered inside a traced function node (isolated from main spine). */
export const buildNestedPropFlowReactFlow = (
  parentFlowNodeId: string,
  bodySteps: PropFlowNode[],
  tracedNodeIds: ReadonlySet<string>,
  onTraceToggle?: (nodeId: string) => void,
  onExpandAll?: (nodeId: string) => void
): {
  nodes: Node<PropFlowStepNodeData>[];
  edges: Edge[];
  height: number;
  width: number;
} => {
  const nodes: Node<PropFlowStepNodeData>[] = [];
  const edges: Edge[] = [];
  const edgeIds = new Set<string>();

  let previousLeaves: string[] = [];

  for (const step of bodySteps) {
    if (previousLeaves.length > 0) {
      const targetId = prefixId(parentFlowNodeId, step.id);
      for (const sourceId of previousLeaves) {
        pushEdge(edges, edgeIds, {
          label: step.transitionLabel,
          source: sourceId,
          suffix: ":seq",
          target: targetId,
        });
      }
    }

    previousLeaves = appendNestedFlowNode(
      parentFlowNodeId,
      step,
      nodes,
      edges,
      edgeIds,
      tracedNodeIds,
      onTraceToggle,
      onExpandAll
    );
  }

  const nodeIdSet = new Set(nodes.map((node) => node.id));
  const validEdges = edges.filter(
    (edge) => nodeIdSet.has(edge.source) && nodeIdSet.has(edge.target)
  );

  const laidOut = layoutNested(nodes, validEdges);

  let maxRight = NESTED_NODE_WIDTH;
  for (const node of laidOut.nodes) {
    maxRight = Math.max(maxRight, node.position.x + NESTED_NODE_WIDTH);
  }

  return {
    ...laidOut,
    width: maxRight + 24,
  };
};
