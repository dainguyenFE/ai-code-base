import { Position } from "@xyflow/react";
import type { Edge, Node } from "@xyflow/react";

import { formatTraceEdgeLabel } from "@/lib/edge-labels";
import {
  NODE_HEIGHT,
  STRUCTURAL_EDGE_TYPES,
  SWIMLANE_HEIGHT,
} from "@/lib/graph-layout";
import type { TraceEdge } from "@/lib/types";

const DEPTH_GAP = 72;

function edgePathOffset(layerDelta: number, edgeType: string): number {
  if (layerDelta <= 0) {
    return 12;
  }

  if (layerDelta === 1) {
    return edgeType === "uses_hook" || edgeType === "renders" ? 10 : 16;
  }

  if (layerDelta === 2) {
    return 28;
  }

  return Math.min(48, Math.round(SWIMLANE_HEIGHT * 0.28));
}

function layerOf(node: Node): number {
  const fromData = node.data?.layer;
  if (typeof fromData === "number") {
    return fromData;
  }

  return Math.round(node.position.y / (NODE_HEIGHT + DEPTH_GAP));
}

function handlePositionsForLayers(
  sourceLayer: number,
  targetLayer: number,
  sourceX: number,
  targetX: number
): { sourcePosition: Position; targetPosition: Position } {
  if (targetLayer > sourceLayer) {
    return { sourcePosition: Position.Bottom, targetPosition: Position.Top };
  }

  if (targetLayer < sourceLayer) {
    return { sourcePosition: Position.Top, targetPosition: Position.Bottom };
  }

  if (targetX >= sourceX) {
    return { sourcePosition: Position.Right, targetPosition: Position.Left };
  }

  return { sourcePosition: Position.Left, targetPosition: Position.Right };
}

function baseEdgeStyle(edgeType: string): Edge["style"] {
  if (edgeType === "passes_prop" || edgeType === "prop_source") {
    return {
      stroke: "#0969da",
      strokeLinecap: "round",
      strokeWidth: 1.75,
    };
  }

  if (
    edgeType === "shows_loading" ||
    edgeType === "shows_error" ||
    edgeType === "shows_not_found"
  ) {
    return {
      stroke: "#9a6700",
      strokeDasharray: "6 4",
      strokeLinecap: "round",
      strokeWidth: 1.5,
    };
  }

  if (edgeType === "wraps") {
    return {
      stroke: "#8250df",
      strokeLinecap: "round",
      strokeWidth: 1.75,
    };
  }

  return {
    stroke: "#8c959f",
    strokeLinecap: "round",
    strokeWidth: 1.5,
  };
}

export function buildFlowEdges(
  edges: TraceEdge[],
  layoutedNodes: Node[]
): Edge[] {
  const nodeById = new Map(layoutedNodes.map((node) => [node.id, node]));
  const seen = new Set<string>();
  const result: Edge[] = [];

  for (const edge of edges) {
    if (!STRUCTURAL_EDGE_TYPES.has(edge.type)) {
      continue;
    }

    const key = `${edge.from}->${edge.to}:${edge.type}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    const sourceNode = nodeById.get(edge.from);
    const targetNode = nodeById.get(edge.to);
    if (!sourceNode || !targetNode) {
      continue;
    }

    const sourceLayer = layerOf(sourceNode);
    const targetLayer = layerOf(targetNode);
    const layerDelta = Math.abs(targetLayer - sourceLayer);
    const { sourcePosition, targetPosition } = handlePositionsForLayers(
      sourceLayer,
      targetLayer,
      sourceNode.position.x,
      targetNode.position.x
    );
    const pathOffset = edgePathOffset(layerDelta, edge.type);

    result.push({
      animated:
        edge.type === "renders" ||
        edge.type === "routes_to" ||
        edge.type === "wraps" ||
        edge.type === "passes_prop" ||
        edge.type === "prop_source",
      data: {
        edgeType: edge.type,
        order: edge.metadata?.order,
        sequenceRank: edge.metadata?.sequenceRank,
        stepKind: edge.metadata?.stepKind,
      },
      id: edge.id,
      label: formatTraceEdgeLabel(edge),
      labelBgBorderRadius: 4,
      labelBgPadding: [4, 2] as [number, number],
      labelBgStyle: { fill: "#ffffff", fillOpacity: 0.95 },
      labelStyle: { fill: "#656d76", fontSize: 11, fontWeight: 500 },
      source: edge.from,
      sourcePosition,
      style: baseEdgeStyle(edge.type),
      target: edge.to,
      targetPosition,
      type: "smoothstep",
      zIndex: 0,
      ...({
        pathOptions: {
          borderRadius: layerDelta <= 1 ? 12 : 18,
          offset: pathOffset,
        },
      } as Record<string, unknown>),
    } as Edge);
  }

  return result;
}

export function getConnectedNodeIds(
  edges: Edge[],
  nodeId: string
): Set<string> {
  const connected = new Set<string>([nodeId]);

  for (const edge of edges) {
    if (edge.source === nodeId) {
      connected.add(edge.target);
    }
    if (edge.target === nodeId) {
      connected.add(edge.source);
    }
  }

  return connected;
}

export function applyEdgeHighlight(
  edges: Edge[],
  highlightId?: string
): Edge[] {
  if (!highlightId) {
    return edges.map((edge) => ({
      ...edge,
      className: undefined,
      style: {
        ...edge.style,
        opacity: 1,
      },
    }));
  }

  return edges.map((edge) => {
    const isOutgoing = edge.source === highlightId;
    const isIncoming = edge.target === highlightId;
    const isConnected = isOutgoing || isIncoming;

    if (!isConnected) {
      return {
        ...edge,
        animated: false,
        className: "trace-edge-dimmed",
        labelStyle: {
          ...(edge.labelStyle as object),
          fill: "#afb8c1",
          fontWeight: 500,
        },
        style: {
          ...edge.style,
          opacity: 0.18,
          stroke: "#d0d7de",
          strokeWidth: 1,
        },
        zIndex: 0,
      };
    }

    return {
      ...edge,
      animated: true,
      className: isOutgoing ? "trace-edge-outgoing" : "trace-edge-incoming",
      labelStyle: {
        ...(edge.labelStyle as object),
        fill: "#0969da",
        fontWeight: 600,
      },
      markerEnd: {
        color: "#0969da",
        height: 18,
        type: "arrowclosed" as const,
        width: 18,
      },
      style: {
        ...edge.style,
        opacity: 1,
        stroke: "#0969da",
        strokeWidth: 2.5,
      },
      zIndex: 12,
    };
  });
}
