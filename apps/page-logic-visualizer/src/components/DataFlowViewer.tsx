"use client";

import {
  buildDataFlowLayers,
  getDataFlowEdges,
  getNodeFlowSummary,
} from "@cs/page-logic-visualizer/client";
import type {
  LogicGraphNode,
  PageLogicGraph,
} from "@cs/page-logic-visualizer/client";
import { useMemo } from "react";

interface DataFlowViewerProps {
  graph: PageLogicGraph;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
}

const LAYER_STYLES = {
  data: "border-emerald-500/40 bg-emerald-500/5",
  logic: "border-violet-500/40 bg-violet-500/5",
  ui: "border-blue-500/40 bg-blue-500/5",
} as const;

export function DataFlowViewer({
  graph,
  selectedNodeId,
  onSelectNode,
}: DataFlowViewerProps) {
  const layers = useMemo(() => buildDataFlowLayers(graph), [graph]);
  const flowEdges = useMemo(() => getDataFlowEdges(graph), [graph.edges]);
  const nodesById = useMemo(
    () => new Map(graph.nodes.map((node) => [node.id, node])),
    [graph.nodes]
  );

  const renderNodeCard = (node: LogicGraphNode) => {
    const summary = getNodeFlowSummary(node);
    const isSelected = selectedNodeId === node.id;

    return (
      <button
        className={
          isSelected
            ? "w-full rounded-md border border-primary bg-primary/10 p-2 text-left text-xs"
            : "w-full rounded-md border bg-background p-2 text-left text-xs hover:bg-accent/50"
        }
        key={node.id}
        onClick={() => onSelectNode(node.id)}
        type="button"
      >
        <span className="font-mono text-[10px] uppercase text-muted-foreground">
          {node.type}
        </span>
        <p className="font-medium">{node.label}</p>
        {summary ? (
          <p className="mt-1 text-muted-foreground">{summary}</p>
        ) : null}
        {node.uiContent?.bindsTo ? (
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            binds: {node.uiContent.bindsTo}
          </p>
        ) : null}
      </button>
    );
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 lg:grid-cols-3">
        {layers.map((layer) => (
          <div
            className={`rounded-lg border p-3 ${LAYER_STYLES[layer.category]}`}
            key={layer.category}
          >
            <h3 className="mb-2 text-sm font-semibold">{layer.label}</h3>
            <div className="max-h-[50vh] space-y-2 overflow-auto">
              {layer.nodes.length === 0 ? (
                <p className="text-xs text-muted-foreground">No nodes</p>
              ) : (
                layer.nodes.map(renderNodeCard)
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border bg-card p-3">
        <h3 className="mb-2 text-sm font-semibold">Data / logic links</h3>
        <ul className="max-h-48 space-y-1 overflow-auto text-xs text-muted-foreground">
          {flowEdges.slice(0, 80).map((edge) => {
            const source = nodesById.get(edge.source);
            const target = nodesById.get(edge.target);
            return (
              <li key={edge.id}>
                <span className="font-medium text-foreground">
                  {source?.label ?? edge.source}
                </span>{" "}
                —{edge.type}
                {edge.label ? ` (${edge.label})` : ""}→{" "}
                <span className="font-medium text-foreground">
                  {target?.label ?? edge.target}
                </span>
              </li>
            );
          })}
          {flowEdges.length > 80 ? (
            <li>…and {flowEdges.length - 80} more edges</li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
