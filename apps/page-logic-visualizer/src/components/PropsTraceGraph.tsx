"use client";

import {
  Background,
  Controls,
  ReactFlow,
  useNodesState,
  useUpdateNodeInternals,
} from "@xyflow/react";
import type { Node, NodeTypes } from "@xyflow/react";

import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { PropFlowStepNode } from "@/components/PropFlowStepNode";
import { collectTraceExpandAllIds } from "@/lib/collectTraceExpandAllIds";
import type { PropFlowNode } from "@/lib/propFlowGraph";
import { EMPTY_PROP_FLOW_NODES } from "@/lib/propFlowGraph";
import {
  buildPropFlowReactFlow,
  buildUsageFlowReactFlow,
  buildWriterFlowReactFlow,
  readNodeHeight,
  readNodeWidth,
  withDimensions,
} from "@/lib/propFlowToReactFlow";
import type { PropFlowStepNodeData } from "@/lib/propFlowToReactFlow";
import type { UsageFlowGraph } from "@/lib/propUsageFlow";
import { walkUsageFlowBranches } from "@/lib/propUsageFlow";

export type PropTraceGraphView = "upstream" | "usage" | "writers";

interface PropsTraceGraphProps {
  flowNodes?: PropFlowNode[];
  usageGraph?: UsageFlowGraph | null;
  writerGraph?: UsageFlowGraph | null;
  graphView?: PropTraceGraphView;
  onGraphViewChange?: (view: PropTraceGraphView) => void;
  showWritersTab?: boolean;
  focusedNodeId: string | null;
  onSelectNode: (node: PropFlowNode) => void;
  title?: string;
  subtitle?: string;
  emptyMessage?: string;
  showTraceHint?: boolean;
  className?: string;
  /** Pre-expand trace rails (e.g. hook sections scoped to an upstream variable). */
  initialTracedNodeIds?: readonly string[];
}

const nodeTypes: NodeTypes = {
  propFlowStep: PropFlowStepNode,
};

const GraphViewToggle = ({
  active,
  onChange,
  showWritersTab = false,
}: {
  active: PropTraceGraphView;
  onChange: (view: PropTraceGraphView) => void;
  showWritersTab?: boolean;
}) => (
  <div
    className="flex shrink-0 rounded-md border bg-muted/40 p-0.5"
    role="tablist"
  >
    {(
      [
        ["upstream", "Upstream"],
        ["usage", "Usage"],
        ...(showWritersTab ? ([["writers", "Writers"]] as const) : []),
      ] as const
    ).map(([value, label]) => (
      <button
        aria-selected={active === value}
        className={[
          "rounded px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide transition-colors",
          active === value
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground",
        ].join(" ")}
        key={value}
        role="tab"
        type="button"
        onClick={() => onChange(value)}
      >
        {label}
      </button>
    ))}
  </div>
);

const defaultEdgeOptions = {
  labelBgBorderRadius: 4,
  labelBgPadding: [3, 2] as [number, number],
  labelShowBg: true,
  labelStyle: {
    fill: "var(--foreground)",
    fontSize: 9,
    fontWeight: 600,
  },
  style: { stroke: "var(--border)", strokeWidth: 1.5 },
};

function TraceGraphInternals({
  nodeIds,
  layoutSignature,
}: {
  nodeIds: string[];
  layoutSignature: string;
}) {
  const updateNodeInternals = useUpdateNodeInternals();

  useEffect(() => {
    for (const id of nodeIds) {
      try {
        updateNodeInternals(id);
      } catch {
        // Skip ids that React Flow cannot resolve (e.g. legacy multiline ids).
      }
    }
  }, [layoutSignature, nodeIds, updateNodeInternals]);

  return null;
}

function mergeLayoutNodes(
  current: Node<PropFlowStepNodeData>[],
  layoutNodes: Node<PropFlowStepNodeData>[],
  resetChildLayout: boolean
): Node<PropFlowStepNodeData>[] {
  const currentById = new Map(current.map((node) => [node.id, node] as const));

  return layoutNodes.map((layoutNode) => {
    const existing = currentById.get(layoutNode.id);
    const isChild = Boolean(layoutNode.parentId);

    const position = resetChildLayout
      ? layoutNode.position
      : (existing && isChild
        ? existing.position
        : (existing?.position ?? layoutNode.position));

    const layoutWidth = readNodeWidth(layoutNode);
    const layoutHeight = readNodeHeight(layoutNode);
    const existingWidth = existing ? readNodeWidth(existing) : layoutWidth;
    const existingHeight = existing ? readNodeHeight(existing) : layoutHeight;

    const traceToggled =
      existing &&
      !isChild &&
      existing.data.isTraced !== layoutNode.data.isTraced;

    const parentAutoFit =
      !isChild &&
      layoutNode.data.isTraced &&
      (traceToggled ||
        resetChildLayout ||
        layoutWidth > existingWidth ||
        layoutHeight > existingHeight);

    const useLayoutSize =
      !existing ||
      (resetChildLayout && isChild) ||
      parentAutoFit ||
      traceToggled;

    const finalWidth = useLayoutSize ? layoutWidth : existingWidth;
    const finalHeight = useLayoutSize ? layoutHeight : existingHeight;

    return withDimensions(
      {
        ...layoutNode,
        position,
      },
      finalWidth,
      finalHeight
    );
  });
}

export function PropsTraceGraph({
  flowNodes = EMPTY_PROP_FLOW_NODES,
  usageGraph = null,
  writerGraph = null,
  graphView = "upstream",
  onGraphViewChange,
  showWritersTab = false,
  focusedNodeId,
  onSelectNode,
  title = "Graph",
  subtitle = "Use the trace rail on the right of traceable nodes to expand or collapse",
  emptyMessage = "No flow steps for this prop.",
  showTraceHint = true,
  className = "",
  initialTracedNodeIds,
}: PropsTraceGraphProps) {
  const isUsageFork = graphView === "usage" && Boolean(usageGraph);
  const isWriterFork = graphView === "writers" && Boolean(writerGraph);
  const [tracedIds, setTracedIds] = useState<Set<string>>(
    () => new Set(initialTracedNodeIds ?? [])
  );
  const [childrenReadyParents, setChildrenReadyParents] = useState<Set<string>>(
    () => new Set()
  );

  const toggleTrace = useCallback((nodeId: string) => {
    setTracedIds((previous) => {
      const next = new Set(previous);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }, []);

  const flowNodeById = useMemo(() => {
    const map = new Map<string, PropFlowNode>();
    const walk = (list: PropFlowNode[]) => {
      for (const node of list) {
        map.set(node.id, node);
        node.expandableSteps?.forEach((child) => walk([child]));
        node.nestedSteps?.forEach((child) => walk([child]));
        node.parallelGroup?.branches.forEach((branch) =>
          branch.steps.forEach((step) => walk([step]))
        );
        node.branchGroup?.branches.forEach((branch) => walk(branch.steps));
      }
    };
    walk(flowNodes);
    if (usageGraph) {
      map.set(usageGraph.intake.id, usageGraph.intake);
      for (const branch of usageGraph.branches) {
        map.set(branch.node.id, branch.node);
        for (const child of branch.children ?? []) {
          map.set(child.node.id, child.node);
        }
      }
    }
    if (writerGraph) {
      map.set(writerGraph.intake.id, writerGraph.intake);
      for (const branch of writerGraph.branches) {
        map.set(branch.node.id, branch.node);
      }
    }
    return map;
  }, [flowNodes, usageGraph, writerGraph]);

  const expandAllFrom = useCallback(
    (nodeId: string) => {
      const root = flowNodeById.get(nodeId);
      if (!root) {
        return;
      }
      const ids = collectTraceExpandAllIds(root);
      setTracedIds((previous) => new Set([...previous, ...ids]));
    },
    [flowNodeById]
  );

  useEffect(() => {
    setChildrenReadyParents((previous) => {
      const next = new Set([...previous].filter((id) => tracedIds.has(id)));
      return next.size === previous.size ? previous : next;
    });
  }, [tracedIds]);

  useEffect(() => {
    const pending = [...tracedIds].filter(
      (id) => !childrenReadyParents.has(id)
    );
    if (pending.length === 0) {
      return;
    }

    let cancelled = false;
    const outer = requestAnimationFrame(() => {
      const inner = requestAnimationFrame(() => {
        if (cancelled) {
          return;
        }
        setChildrenReadyParents(
          (previous) => new Set([...previous, ...pending])
        );
      });
      return () => cancelAnimationFrame(inner);
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(outer);
    };
  }, [tracedIds, childrenReadyParents]);

  const tracedSignature = useMemo(
    () => [...tracedIds].toSorted().join("|"),
    [tracedIds]
  );

  const childrenReadySignature = useMemo(
    () => [...childrenReadyParents].toSorted().join("|"),
    [childrenReadyParents]
  );

  const layoutKey = useMemo(() => {
    const forkGraph = isWriterFork ? writerGraph : usageGraph;
    if ((isUsageFork || isWriterFork) && forkGraph) {
      return [
        forkGraph.intake.id,
        ...forkGraph.branches.flatMap((branch) => {
          const ids = [branch.node.id];
          walkUsageFlowBranches(branch.children ?? [], (child) => {
            ids.push(child.node.id);
          });
          return ids;
        }),
      ].join("|");
    }
    return flowNodes.map((node) => node.id).join("|");
  }, [flowNodes, isUsageFork, isWriterFork, usageGraph, writerGraph]);

  const layout = useMemo(() => {
    if (isWriterFork && writerGraph) {
      return buildWriterFlowReactFlow(writerGraph, focusedNodeId);
    }
    if (isUsageFork && usageGraph) {
      return buildUsageFlowReactFlow(usageGraph, focusedNodeId);
    }
    return buildPropFlowReactFlow(
      flowNodes,
      focusedNodeId,
      tracedIds,
      toggleTrace,
      childrenReadyParents,
      expandAllFrom
    );
  }, [
    childrenReadyParents,
    expandAllFrom,
    flowNodes,
    focusedNodeId,
    isUsageFork,
    isWriterFork,
    tracedIds,
    toggleTrace,
    usageGraph,
    writerGraph,
  ]);

  const graphRevision = `${layoutKey}::${tracedSignature}::${childrenReadySignature}::focus:${focusedNodeId ?? ""}`;
  const previousRevision = useRef(graphRevision);

  const [nodes, setNodes, onNodesChange] = useNodesState<
    Node<PropFlowStepNodeData>
  >(layout.nodes);

  useEffect(() => {
    const resetChildLayout = previousRevision.current !== graphRevision;
    previousRevision.current = graphRevision;

    setNodes((current) =>
      mergeLayoutNodes(current, layout.nodes, resetChildLayout)
    );
  }, [graphRevision, layout, setNodes]);

  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node<PropFlowStepNodeData>) => {
      const flowNode = flowNodeById.get(node.data.flowNode.id);
      if (flowNode) {
        onSelectNode(flowNode);
      }
    },
    [flowNodeById, onSelectNode]
  );

  const nodeIds = useMemo(() => nodes.map((node) => node.id), [nodes]);

  const isEmpty = isWriterFork
    ? !writerGraph || writerGraph.branches.length === 0
    : (isUsageFork
      ? !usageGraph || usageGraph.branches.length === 0
      : flowNodes.length === 0);

  if (isEmpty) {
    return (
      <div
        className={`flex h-full min-h-0 flex-col rounded-lg border bg-card ${className}`}
      >
        <div className="shrink-0 border-b px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">{title}</h2>
            {onGraphViewChange ? (
              <GraphViewToggle
                active={graphView}
                onChange={onGraphViewChange}
                showWritersTab={showWritersTab}
              />
            ) : null}
          </div>
          {subtitle ? (
            <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
        <div className="flex flex-1 items-center justify-center p-4 text-center text-sm text-muted-foreground">
          <p>{emptyMessage}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex h-full min-h-0 flex-col rounded-lg border bg-card ${className}`}
    >
      <div className="shrink-0 border-b px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">{title}</h2>
          {onGraphViewChange ? (
            <GraphViewToggle
              active={graphView}
              onChange={onGraphViewChange}
              showWritersTab={showWritersTab}
            />
          ) : null}
        </div>
        {subtitle ? (
          <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>

      <div className="relative min-h-[160px] flex-1">
        <ReactFlow
          className="!h-full !w-full"
          defaultEdgeOptions={defaultEdgeOptions}
          edges={layout.edges}
          minZoom={0.25}
          nodes={nodes}
          nodesConnectable={false}
          nodesDraggable
          nodeTypes={nodeTypes}
          onNodeClick={onNodeClick}
          onNodesChange={onNodesChange}
          proOptions={{ hideAttribution: true }}
          selectNodesOnDrag={false}
        >
          <TraceGraphInternals
            layoutSignature={graphRevision}
            nodeIds={nodeIds}
          />
          <Background gap={16} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  );
}
