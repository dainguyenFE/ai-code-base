"use client";

import type {
  TraceLayer,
  TraceLayerGraph,
  TraceLayerNode,
} from "@cs/page-logic-visualizer/client";
import { useMemo } from "react";

import { LAYER_LABELS } from "./LayerFilterBar";

const NODE_STYLES: Record<string, string> = {
  "api-call": "border-sky-500/40 bg-sky-500/10",
  "callback-handler": "border-amber-500/40 bg-amber-500/10",
  component: "border-blue-500/40 bg-blue-500/10",
  context: "border-violet-500/40 bg-violet-500/10",
  "data-fetch": "border-emerald-500/40 bg-emerald-500/10",
  "event-handler": "border-orange-500/40 bg-orange-500/10",
  file: "border-slate-500/40 bg-slate-500/10",
  "hook-result": "border-purple-500/40 bg-purple-500/10",
  "inline-handler": "border-amber-500/40 bg-amber-500/10",
  "jsx-prop": "border-cyan-500/40 bg-cyan-500/10",
  module: "border-slate-500/40 bg-slate-500/10",
  "query-hook": "border-sky-500/40 bg-sky-500/10",
  "react-state": "border-pink-500/40 bg-pink-500/10",
  "router-action": "border-indigo-500/40 bg-indigo-500/10",
  "state-setter": "border-rose-500/40 bg-rose-500/10",
  "state-update": "border-rose-500/40 bg-rose-500/10",
  transform: "border-teal-500/40 bg-teal-500/10",
  variable: "border-emerald-500/40 bg-emerald-500/10",
  "workspace-package": "border-slate-500/40 bg-slate-500/10",
  "zustand-store": "border-fuchsia-500/40 bg-fuchsia-500/10",
};

interface TraceLayerViewerProps {
  layerGraph: TraceLayerGraph;
  selectedNodeId: string | null;
  onSelectNode: (node: TraceLayerNode) => void;
  search?: string;
}

export function TraceLayerViewer({
  layerGraph,
  selectedNodeId,
  onSelectNode,
  search = "",
}: TraceLayerViewerProps) {
  const normalized = search.trim().toLowerCase();

  const nodes = useMemo(() => {
    if (!normalized) {
      return layerGraph.nodes;
    }
    return layerGraph.nodes.filter(
      (node) =>
        node.label.toLowerCase().includes(normalized) ||
        node.file?.toLowerCase().includes(normalized) ||
        node.code?.toLowerCase().includes(normalized)
    );
  }, [layerGraph.nodes, normalized]);

  const nodeIdSet = useMemo(
    () => new Set(nodes.map((node) => node.id)),
    [nodes]
  );

  const edges = useMemo(
    () =>
      layerGraph.edges.filter(
        (edge) => nodeIdSet.has(edge.from) && nodeIdSet.has(edge.to)
      ),
    [layerGraph.edges, nodeIdSet]
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">
            {LAYER_LABELS[layerGraph.layer]} trace
          </h3>
          {layerGraph.target ? (
            <p className="font-mono text-[10px] text-muted-foreground">
              target: {layerGraph.target}
            </p>
          ) : null}
        </div>
        <span className="text-xs text-muted-foreground">
          {nodes.length} nodes · {edges.length} edges
        </span>
      </div>

      {nodes.length === 0 ? (
        <p className="rounded-lg border p-4 text-sm text-muted-foreground">
          No nodes for this layer. Try another filter or select a data/event
          target.
        </p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(12rem,16rem)]">
          <div className="space-y-2 rounded-lg border bg-card p-3">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Nodes
            </h4>
            <ul className="max-h-[50vh] space-y-2 overflow-y-auto">
              {nodes.map((node) => (
                <li key={node.id}>
                  <button
                    className={[
                      "w-full rounded-md border p-2 text-start text-xs transition-colors",
                      NODE_STYLES[node.type] ?? "border-border bg-background",
                      selectedNodeId === node.id ? "ring-2 ring-primary" : "",
                    ].join(" ")}
                    onClick={() => onSelectNode(node)}
                    type="button"
                  >
                    <span className="font-mono text-[10px] uppercase text-muted-foreground">
                      {node.type}
                    </span>
                    <p className="font-medium">{node.label}</p>
                    {node.code ? (
                      <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
                        {node.code}
                      </p>
                    ) : null}
                    {node.file ? (
                      <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                        {node.file}
                        {node.line ? `:${node.line}` : ""}
                      </p>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-lg border bg-card p-3">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Edges
            </h4>
            <ul className="mt-2 max-h-[50vh] space-y-1 overflow-y-auto text-xs">
              {edges.length === 0 ? (
                <li className="text-muted-foreground">No edges</li>
              ) : (
                edges.map((edge) => (
                  <li className="font-mono text-[10px]" key={edge.id}>
                    <span className="text-muted-foreground">{edge.type}</span>
                    <span className="mx-1">→</span>
                    {edge.label ?? `${edge.from.slice(0, 12)}…`}
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

export type ExtendedTraceLevel = "route" | "component" | "hook" | TraceLayer;

export const isExtendedLayer = (
  level: ExtendedTraceLevel
): level is TraceLayer =>
  [
    "data-flow",
    "dependency",
    "data-source",
    "state-store",
    "event-action",
  ].includes(level);
