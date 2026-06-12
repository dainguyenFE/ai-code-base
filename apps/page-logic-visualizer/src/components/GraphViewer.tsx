"use client";

import {
  getNodeFlowSummary,
  isNodeExpandable,
} from "@cs/page-logic-visualizer/client";
import type {
  LogicGraphEdge,
  LogicGraphNode,
  LogicGraphNodeType,
  PageLogicGraph,
} from "@cs/page-logic-visualizer/client";
import { useMemo, useState } from "react";

interface GraphViewerProps {
  graph: PageLogicGraph;
  selectedNodeId: string | null;
  search: string;
  typeFilter: LogicGraphNodeType | "all";
  expandingNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  onExpandNode: (node: LogicGraphNode) => void;
}

const NODE_TYPE_COLORS: Record<LogicGraphNodeType, string> = {
  component: "text-blue-600",
  condition: "text-amber-600",
  context: "text-teal-600",
  "data-fetch": "text-emerald-600",
  "dynamic-import": "text-violet-600",
  hook: "text-violet-700",
  layout: "text-slate-600",
  loop: "text-orange-600",
  page: "text-foreground font-semibold",
  route: "text-slate-600",
  slot: "text-slate-500",
  store: "text-fuchsia-600",
  "ui-content": "text-sky-600",
  unknown: "text-muted-foreground",
};

const EDGE_TYPE_LABELS: Record<string, string> = {
  calls: "calls",
  "condition-false": "false →",
  "condition-true": "true →",
  displays: "displays",
  "hook-input": "input",
  "hook-output": "output",
  "loop-renders": "each →",
  renders: "renders",
  "uses-hook": "uses hook",
};

const matchesSearch = (node: LogicGraphNode, search: string): boolean => {
  if (!search) {
    return true;
  }
  const haystack = [
    node.label,
    node.importPath,
    node.filePath,
    node.packageName,
    node.condition?.expression,
    node.condition?.trueOutput,
    node.condition?.falseOutput,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(search.toLowerCase());
};

const nodeMatchesFilter = (
  node: LogicGraphNode,
  typeFilter: LogicGraphNodeType | "all"
): boolean => typeFilter === "all" || node.type === typeFilter;

const subtreeHasVisibleNode = (
  nodeId: string,
  childrenBySource: Map<string, LogicGraphEdge[]>,
  nodesById: Map<string, LogicGraphNode>,
  search: string,
  typeFilter: LogicGraphNodeType | "all"
): boolean => {
  const node = nodesById.get(nodeId);
  if (
    node &&
    nodeMatchesFilter(node, typeFilter) &&
    matchesSearch(node, search)
  ) {
    return true;
  }
  for (const edge of childrenBySource.get(nodeId) ?? []) {
    if (
      subtreeHasVisibleNode(
        edge.target,
        childrenBySource,
        nodesById,
        search,
        typeFilter
      )
    ) {
      return true;
    }
  }
  return false;
};

const TreeNode = ({
  node,
  childrenBySource,
  nodesById,
  selectedNodeId,
  search,
  typeFilter,
  depth,
  collapsedIds,
  expandingNodeId,
  onSelectNode,
  onExpandNode,
  onToggleCollapse,
}: {
  node: LogicGraphNode;
  childrenBySource: Map<string, LogicGraphEdge[]>;
  nodesById: Map<string, LogicGraphNode>;
  selectedNodeId: string | null;
  search: string;
  typeFilter: LogicGraphNodeType | "all";
  depth: number;
  collapsedIds: Set<string>;
  expandingNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  onExpandNode: (node: LogicGraphNode) => void;
  onToggleCollapse: (nodeId: string) => void;
}) => {
  const childEdges = childrenBySource.get(node.id) ?? [];
  const visible =
    nodeMatchesFilter(node, typeFilter) && matchesSearch(node, search);
  const isExpanded = node.metadata?.expanded === true;
  const canExpand = isNodeExpandable(node);
  const hasChildren = childEdges.length > 0;
  const isCollapsed = collapsedIds.has(node.id);
  const showChildren = hasChildren && !isCollapsed;

  if (
    !visible &&
    !subtreeHasVisibleNode(
      node.id,
      childrenBySource,
      nodesById,
      search,
      typeFilter
    )
  ) {
    return null;
  }

  return (
    <div style={{ marginLeft: depth * 14 }}>
      <div className="mb-0.5 flex items-start gap-1">
        {hasChildren ? (
          <button
            aria-label={isCollapsed ? "Expand branch" : "Collapse branch"}
            className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded border text-xs hover:bg-accent"
            onClick={() => onToggleCollapse(node.id)}
            type="button"
          >
            {isCollapsed ? "+" : "−"}
          </button>
        ) : (
          <span className="size-5 shrink-0" />
        )}

        {canExpand ? (
          <button
            className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded border border-primary/40 text-xs text-primary hover:bg-accent"
            disabled={expandingNodeId === node.id || isExpanded}
            onClick={() => onExpandNode(node)}
            title={
              isExpanded
                ? "Already expanded"
                : "Analyze and expand component internals"
            }
            type="button"
          >
            {expandingNodeId === node.id ? "…" : (isExpanded ? "✓" : "↳")}
          </button>
        ) : (
          <span className="size-5 shrink-0" />
        )}

        {visible ? (
          <button
            className={
              selectedNodeId === node.id
                ? "min-w-0 flex-1 rounded bg-accent px-2 py-1 text-left text-sm"
                : "min-w-0 flex-1 rounded px-2 py-1 text-left text-sm hover:bg-accent/60"
            }
            onClick={() => onSelectNode(node.id)}
            type="button"
          >
            <span
              className={`me-2 font-mono text-[10px] uppercase ${NODE_TYPE_COLORS[node.type]}`}
            >
              {node.type}
            </span>
            <span className="font-medium">{node.label}</span>
            {node.packageName ? (
              <span className="ms-1 text-xs text-muted-foreground">
                [{node.packageName}]
              </span>
            ) : null}
            {node.type === "condition" && node.condition?.trueOutput ? (
              <span className="mt-0.5 block text-xs text-muted-foreground">
                true → {node.condition.trueOutput}
                {node.condition.falseOutput
                  ? ` · false → ${node.condition.falseOutput}`
                  : ""}
              </span>
            ) : null}
            {getNodeFlowSummary(node) ? (
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {getNodeFlowSummary(node)}
              </span>
            ) : null}
          </button>
        ) : (
          <span className="min-w-0 flex-1 px-2 py-1 text-xs text-muted-foreground">
            …
          </span>
        )}
      </div>

      {showChildren
        ? childEdges.map((edge) => {
            const child = nodesById.get(edge.target);
            if (!child) {
              return null;
            }
            return (
              <div key={edge.id}>
                <div
                  className="py-0.5 text-[11px] text-muted-foreground"
                  style={{ marginLeft: 28 + depth * 14 }}
                >
                  {EDGE_TYPE_LABELS[edge.type] ?? edge.type}
                  {edge.label ? ` (${edge.label})` : ""}
                </div>
                <TreeNode
                  childrenBySource={childrenBySource}
                  collapsedIds={collapsedIds}
                  depth={depth + 1}
                  expandingNodeId={expandingNodeId}
                  node={child}
                  nodesById={nodesById}
                  onExpandNode={onExpandNode}
                  onSelectNode={onSelectNode}
                  onToggleCollapse={onToggleCollapse}
                  search={search}
                  selectedNodeId={selectedNodeId}
                  typeFilter={typeFilter}
                />
              </div>
            );
          })
        : null}
    </div>
  );
};

export function GraphViewer({
  graph,
  selectedNodeId,
  search,
  typeFilter,
  expandingNodeId,
  onSelectNode,
  onExpandNode,
}: GraphViewerProps) {
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());

  const nodesById = useMemo(
    () => new Map(graph.nodes.map((node) => [node.id, node])),
    [graph.nodes]
  );

  const childrenBySource = useMemo(() => {
    const map = new Map<string, LogicGraphEdge[]>();
    for (const edge of graph.edges) {
      const list = map.get(edge.source) ?? [];
      list.push(edge);
      map.set(edge.source, list);
    }
    return map;
  }, [graph.edges]);

  const root = nodesById.get(graph.rootNodeId);

  const toggleCollapse = (nodeId: string) => {
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  if (!root) {
    return (
      <div className="rounded-lg border p-4 text-sm text-muted-foreground">
        No graph data to display.
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="mb-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span>Nodes: {graph.nodes.length}</span>
        <span>Edges: {graph.edges.length}</span>
        <span>Warnings: {graph.warnings.length}</span>
        <span>
          <code className="rounded bg-muted px-1">−/+</code> collapse branch ·{" "}
          <code className="rounded bg-muted px-1">↳</code> expand component
        </span>
      </div>
      <TreeNode
        childrenBySource={childrenBySource}
        collapsedIds={collapsedIds}
        depth={0}
        expandingNodeId={expandingNodeId}
        node={root}
        nodesById={nodesById}
        onExpandNode={onExpandNode}
        onSelectNode={onSelectNode}
        onToggleCollapse={toggleCollapse}
        search={search}
        selectedNodeId={selectedNodeId}
        typeFilter={typeFilter}
      />
    </div>
  );
}
