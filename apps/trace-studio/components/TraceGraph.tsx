"use client";

import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import type { Edge, Node, NodeTypes } from "@xyflow/react";
import { useEffect, useMemo } from "react";

import "@xyflow/react/dist/style.css";

import {
  buildNodeBadges,
  filterComponentGraphEdges,
} from "@/lib/component-view";
import { filterDataFlowEdges } from "@/lib/data-flow-view";
import {
  applyEdgeHighlight,
  buildFlowEdges,
  getConnectedNodeIds,
} from "@/lib/graph-edges";
import {
  filterLayoutTraceEdges,
  layoutHierarchicalNodes,
  measureTraceNodeDimensions,
} from "@/lib/graph-layout";
import type { TraceEdge, TraceNode, TraceViewMode } from "@/lib/types";

import { TraceFlowNode } from "./TraceFlowNode";

const nodeTypes: NodeTypes = {
  traceNode: TraceFlowNode,
};

const NODE_MINIMAP_COLORS: Record<string, string> = {
  builtin: "#9a6700",
  component: "var(--node-component-border)",
  error: "#cf222e",
  external: "#cf222e",
  file: "var(--node-default-border)",
  function: "var(--node-function-border)",
  hook: "var(--node-hook-border)",
  layout: "#8250df",
  loading: "#9a6700",
  not_found: "#cf222e",
  page: "#0969da",
  route: "var(--node-route-border)",
};

function nodeMiniMapColor(type: string): string {
  return NODE_MINIMAP_COLORS[type] ?? "var(--node-default-border)";
}

function toFlowNode(node: TraceNode, variant: TraceGraphVariant): Node {
  const dataFlowMode = variant === "data-flow";
  const isPropSink = Boolean(node.metadata?.isPropSink);
  const isComponentContext =
    dataFlowMode && node.type === "component" && !isPropSink;
  const badges = dataFlowMode
    ? isPropSink
      ? ["selected prop"]
      : node.type === "prop"
        ? ["prop"]
        : node.type === "variable"
          ? ["binding"]
          : isComponentContext
            ? ["parent"]
            : []
    : buildNodeBadges(node);
  const displayType =
    node.type === "prop"
      ? "prop"
      : node.type === "variable"
        ? "variable"
        : isComponentContext
          ? "data"
          : node.type;
  const { width, height } = measureTraceNodeDimensions(
    badges.length > 0 ? `${node.label} · ${badges.join(" ")}` : node.label,
    displayType
  );

  return {
    className: "trace-flow-node",
    data: {
      badges,
      dataFlowMode,
      dimmed: false,
      isCenter: false,
      isComponentContext,
      isPropSink,
      label: node.label,
      nodeType: displayType,
    },
    draggable: true,
    height,
    id: node.id,
    position: { x: 0, y: 0 },
    type: "traceNode",
    width,
    zIndex: 2,
  };
}

export type TraceGraphVariant = "composition" | "data-flow" | "full";

interface TraceGraphProps {
  nodes: TraceNode[];
  edges: TraceEdge[];
  graphMode?: TraceViewMode;
  graphVariant?: TraceGraphVariant;
  highlightId?: string;
  layoutAnchorId?: string;
  onNodeClick: (nodeId: string) => void;
}

function TraceGraphCanvas({
  nodes,
  edges,
  graphMode = "component",
  graphVariant = "full",
  highlightId,
  layoutAnchorId,
  onNodeClick,
}: TraceGraphProps) {
  const { fitView } = useReactFlow();
  const isCompact =
    graphVariant === "composition" || graphVariant === "data-flow";

  const visibleNodes = useMemo(() => {
    if (graphVariant === "data-flow") {
      return nodes.filter(
        (node) =>
          node.type !== "route" &&
          node.type !== "page" &&
          node.type !== "layout"
      );
    }
    return nodes;
  }, [nodes, graphVariant]);

  const structuralEdges = useMemo(() => {
    if (graphVariant === "data-flow") {
      return filterDataFlowEdges(edges);
    }
    if (graphMode === "component" || graphVariant === "composition") {
      return filterComponentGraphEdges(edges);
    }
    return filterLayoutTraceEdges(edges);
  }, [edges, graphMode, graphVariant]);

  const layoutedNodes = useMemo(() => {
    const flowNodes = visibleNodes.map((node) =>
      toFlowNode(node, graphVariant)
    );

    if (graphVariant === "data-flow") {
      const sinkId = visibleNodes.find((node) => node.metadata?.isPropSink)?.id;
      const layoutEdges: Edge[] = structuralEdges.map((edge) => ({
        data: { edgeType: edge.type },
        id: `${edge.to}->${edge.from}:${edge.type}`,
        label: edge.type,
        source: edge.to,
        target: edge.from,
      }));
      const layout = layoutHierarchicalNodes(flowNodes, layoutEdges, {
        centerId: sinkId,
      });
      const maxY = layout.nodes.reduce(
        (max, node) => Math.max(max, node.position.y),
        0
      );
      return layout.nodes.map((node) => ({
        ...node,
        position: {
          x: node.position.x,
          y: maxY - node.position.y,
        },
      }));
    }

    const layoutEdges: Edge[] = structuralEdges.map((edge) => ({
      data: { edgeType: edge.type },
      id: edge.id,
      label: edge.type,
      source: edge.from,
      target: edge.to,
    }));

    return layoutHierarchicalNodes(flowNodes, layoutEdges, {
      centerId: layoutAnchorId,
      maxNodesPerRow: graphVariant === "composition" ? 3 : 4,
    }).nodes;
  }, [visibleNodes, structuralEdges, layoutAnchorId, graphVariant]);

  const layoutKey = useMemo(
    () =>
      layoutedNodes
        .map((node) => `${node.id}:${node.position.x},${node.position.y}`)
        .join("|"),
    [layoutedNodes]
  );

  const baseFlowEdges = useMemo(
    () => buildFlowEdges(structuralEdges, layoutedNodes),
    [structuralEdges, layoutedNodes]
  );

  const highlightedEdges = useMemo(
    () => applyEdgeHighlight(baseFlowEdges, highlightId),
    [baseFlowEdges, highlightId]
  );

  const connectedIds = useMemo(
    () =>
      highlightId
        ? getConnectedNodeIds(baseFlowEdges, highlightId)
        : new Set<string>(),
    [baseFlowEdges, highlightId]
  );

  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState(layoutedNodes);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState(highlightedEdges);

  useEffect(() => {
    setFlowNodes(layoutedNodes);
    setRfEdges(highlightedEdges);
  }, [layoutedNodes, highlightedEdges, setFlowNodes, setRfEdges]);

  useEffect(() => {
    setFlowNodes((current) =>
      current.map((node) => {
        const isHighlighted = node.id === highlightId;
        const isNeighbor =
          Boolean(highlightId) &&
          connectedIds.has(node.id) &&
          node.id !== highlightId;
        const dimmed = Boolean(highlightId) && !isHighlighted && !isNeighbor;

        return {
          ...node,
          data: {
            ...node.data,
            dimmed,
            isCenter: isHighlighted,
          },
          selected: isHighlighted,
          zIndex: isHighlighted ? 20 : isNeighbor ? 8 : 2,
        };
      })
    );
  }, [highlightId, connectedIds, setFlowNodes]);

  useEffect(() => {
    if (layoutedNodes.length === 0) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      void fitView({
        duration: 200,
        maxZoom: 1.25,
        minZoom: 0.05,
        padding: 0.08,
      });
    });

    return () => cancelAnimationFrame(frame);
  }, [layoutKey, layoutedNodes.length, fitView]);

  if (nodes.length === 0) {
    return (
      <div
        style={{
          alignItems: "center",
          color: "var(--muted)",
          display: "flex",
          fontSize: 12,
          height: "100%",
          justifyContent: "center",
          padding: 16,
          textAlign: "center",
        }}
      >
        {graphVariant === "data-flow"
          ? "Select a prop in the inspector to trace upstream data flow."
          : "Search a component or route to start tracing."}
      </div>
    );
  }

  return (
    <ReactFlow
      defaultEdgeOptions={{ type: "smoothstep" }}
      edges={rfEdges}
      elevateEdgesOnSelect={false}
      elevateNodesOnSelect
      fitView
      maxZoom={1.25}
      minZoom={0.05}
      nodeTypes={nodeTypes}
      nodes={flowNodes}
      nodesConnectable={false}
      nodesDraggable
      onEdgesChange={onEdgesChange}
      onNodeClick={(_, node) => onNodeClick(node.id)}
      onNodesChange={onNodesChange}
      proOptions={{ hideAttribution: true }}
      zoomOnDoubleClick={false}
    >
      <Background color="#d0d7de" gap={20} size={1} />
      <Controls showInteractive={false} />
      {isCompact ? null : (
        <MiniMap
          nodeColor={(node) =>
            nodeMiniMapColor(String(node.data?.nodeType ?? "component"))
          }
          pannable
          zoomable
        />
      )}
    </ReactFlow>
  );
}

export function TraceGraph(props: TraceGraphProps) {
  return (
    <ReactFlowProvider>
      <TraceGraphCanvas {...props} />
    </ReactFlowProvider>
  );
}
