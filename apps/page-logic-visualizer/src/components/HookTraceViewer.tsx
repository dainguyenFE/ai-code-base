"use client";

import type {
  HookTraceView,
  PageLogicGraph,
} from "@cs/page-logic-visualizer/client";
import {
  findPropFlowGraphNodeById,
  hookCallNameFromGraphNode,
} from "@cs/page-logic-visualizer/client";
import { useCallback, useEffect, useMemo, useState } from "react";

import { HookTraceInspector } from "@/components/HookTraceInspector";
import { PropsTraceGraph } from "@/components/PropsTraceGraph";
import { SourceCodePanel } from "@/components/SourceCodePanel";
import type { HookTraceRequest } from "@/components/UiGraphViewer";
import {
  buildEffectFlowNodes,
  buildHookUsageFlowGraph,
  collectHookAutoExpandIds,
  defaultHookTraceGraphView,
  hookInternalToFlowNodes,
} from "@/lib/hookTraceFlow";
import type { HookTraceGraphView } from "@/lib/hookTraceFlow";
import { resolveHookFlowNodeFocus } from "@/lib/hookTraceSource";
import type { PropFlowNode } from "@/lib/propFlowGraph";
import { resolveTraceFocus } from "@/lib/sourceView";
import type { SourceViewTarget } from "@/lib/sourceView";

interface HookTraceViewerProps {
  trace: HookTraceView;
  graph?: PageLogicGraph;
  consumerNodeId?: string;
  consumerLabel?: string;
  onSelectHook?: (request: HookTraceRequest) => void;
  embedded?: boolean;
}

const GraphViewToggle = ({
  active,
  onChange,
  showEffect,
  showUsage,
}: {
  active: HookTraceGraphView;
  onChange: (view: HookTraceGraphView) => void;
  showEffect: boolean;
  showUsage: boolean;
}) => (
  <div
    className="flex shrink-0 rounded-md border bg-muted/40 p-0.5"
    role="tablist"
  >
    {(
      [
        ["internal", "Internal"],
        ...(showUsage ? ([["usage", "Usage"]] as const) : []),
        ...(showEffect ? ([["effect", "Effect"]] as const) : []),
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
        onClick={() => onChange(value)}
        role="tab"
        type="button"
      >
        {label}
      </button>
    ))}
  </div>
);

export function HookTraceViewer({
  trace,
  graph,
  consumerNodeId,
  consumerLabel,
  onSelectHook,
  embedded = false,
}: HookTraceViewerProps) {
  const showUsage = Boolean(
    trace.returnFields.length > 0 || (trace.usages?.length ?? 0) > 0
  );
  const showEffect = trace.effects.length > 0;

  const [graphView, setGraphView] = useState<HookTraceGraphView>(() =>
    defaultHookTraceGraphView(trace)
  );
  const [focusedFlowNodeId, setFocusedFlowNodeId] = useState<string | null>(
    null
  );
  const [sourceTarget, setSourceTarget] = useState<SourceViewTarget | null>(
    null
  );
  const [sourceNotice, setSourceNotice] = useState<string | null>(null);

  const siblingHooks = useMemo(() => {
    if (!graph || !consumerNodeId) {
      return [];
    }
    return graph.edges
      .filter(
        (edge) => edge.type === "uses-hook" && edge.source === consumerNodeId
      )
      .map((edge) => graph.nodes.find((node) => node.id === edge.target))
      .filter(
        (
          node
        ): node is NonNullable<typeof node> &
          ({ type: "hook" } | { type: "store" } | { type: "context" }) =>
          node?.type === "hook" ||
          node?.type === "store" ||
          node?.type === "context"
      )
      .map((node) => ({
        hookNodeId: node.id,
        label: hookCallNameFromGraphNode(node) ?? node.label,
      }));
  }, [consumerNodeId, graph]);

  useEffect(() => {
    setGraphView(defaultHookTraceGraphView(trace));
    setFocusedFlowNodeId(null);
    setSourceNotice(null);

    if (!embedded || !graph) {
      return;
    }

    const { notice, target } = resolveTraceFocus(graph, trace.hookNodeId, {
      contextHookNodeId: trace.hookNodeId,
      definitionFilePath: trace.definitionFilePath,
      definitionSymbol: trace.definitionSymbol ?? trace.hookName,
      label: trace.hookName,
      loc: trace.callSiteLoc,
    });
    setSourceNotice(notice);
    setSourceTarget(target);
  }, [
    embedded,
    graph,
    trace.callSiteLoc,
    trace.definitionFilePath,
    trace.definitionSymbol,
    trace.hookName,
    trace.hookNodeId,
    trace.traceScope,
  ]);

  const internalFlowNodes = useMemo(
    () => hookInternalToFlowNodes(trace),
    [trace]
  );
  const autoExpandIds = useMemo(() => collectHookAutoExpandIds(trace), [trace]);
  const usageGraph = useMemo(() => buildHookUsageFlowGraph(trace), [trace]);
  const effectFlowNodes = useMemo(() => buildEffectFlowNodes(trace), [trace]);

  const activeFlowNodes =
    graphView === "effect"
      ? effectFlowNodes
      : (graphView === "usage"
        ? []
        : internalFlowNodes);

  const openSourceForFlowNode = useCallback(
    (node: PropFlowNode) => {
      setFocusedFlowNodeId(node.id);

      if (!graph) {
        return;
      }

      const { notice, target } = resolveHookFlowNodeFocus(graph, trace, node);
      setSourceNotice(notice);
      setSourceTarget(target);
    },
    [graph, trace]
  );

  const openHookDefinition = useCallback(() => {
    if (!graph) {
      return;
    }
    const { notice, target } = resolveTraceFocus(graph, trace.hookNodeId, {
      contextHookNodeId: trace.hookNodeId,
      definitionFilePath: trace.definitionFilePath,
      definitionSymbol: trace.definitionSymbol ?? trace.hookName,
      label: trace.hookName,
      loc: trace.callSiteLoc,
    });
    setSourceNotice(notice);
    setSourceTarget(target);
  }, [graph, trace]);

  const focusedNode =
    focusedFlowNodeId && graphView !== "usage"
      ? findPropFlowGraphNodeById(activeFlowNodes, focusedFlowNodeId)
      : undefined;

  const subtitle =
    graphView === "internal"
      ? (trace.focusedReturnField
        ? `Input → Logic → Return — highlighting paths related to ${trace.focusedReturnField}`
        : "Input → Logic → Return")
      : (graphView === "usage"
        ? "Return values and where the consumer uses them"
        : "Effect runs after each render when dependencies change");

  const graphSection = (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          {!embedded ? (
            <button
              className="font-mono text-sm font-semibold underline"
              onClick={openHookDefinition}
              type="button"
            >
              {trace.bindingVariable
                ? `${trace.bindingVariable} ← ${trace.hookName}()`
                : `${trace.hookName}()`}
            </button>
          ) : (
            <p className="font-mono text-xs font-semibold">
              {graphView === "effect"
                ? "Effect lifecycle"
                : (graphView === "usage"
                  ? "Return usage"
                  : "Hook implementation")}
            </p>
          )}
          <p className="mt-0.5 text-[11px] text-muted-foreground">{subtitle}</p>
        </div>
        <GraphViewToggle
          active={graphView}
          onChange={setGraphView}
          showEffect={showEffect}
          showUsage={showUsage}
        />
      </div>

      <div className="min-h-[320px] flex-1 overflow-hidden rounded-lg border bg-background">
        {graphView === "usage" ? (
          usageGraph ? (
            <PropsTraceGraph
              className="h-full"
              focusedNodeId={focusedFlowNodeId}
              graphView="usage"
              key={`${trace.hookNodeId}:usage`}
              onSelectNode={openSourceForFlowNode}
              showTraceHint={false}
              subtitle="Each branch is a returned field and its downstream usage"
              title="Return usage"
              usageGraph={usageGraph}
            />
          ) : (
            <p className="p-4 text-sm text-muted-foreground">
              No return values or usages detected for this hook.
            </p>
          )
        ) : (activeFlowNodes.length > 0 ? (
          <PropsTraceGraph
            className="h-full"
            flowNodes={activeFlowNodes}
            focusedNodeId={focusedFlowNodeId}
            graphView="upstream"
            initialTracedNodeIds={
              graphView === "internal" ? autoExpandIds : undefined
            }
            key={`${trace.hookNodeId}:${graphView}:${trace.focusedReturnField ?? "full"}`}
            onSelectNode={openSourceForFlowNode}
            showTraceHint={graphView === "internal"}
            subtitle={
              graphView === "effect" ? focusedNode?.label : focusedNode?.detail
            }
            title={
              graphView === "effect"
                ? "Effect lifecycle"
                : "Hook implementation"
            }
          />
        ) : (
          <p className="p-4 text-sm text-muted-foreground">
            No hook body graph available for this trace.
          </p>
        ))}
      </div>
    </div>
  );

  if (!embedded) {
    return (
      <div className="flex h-[min(70vh,720px)] min-h-0 flex-col gap-3">
        {graphSection}
      </div>
    );
  }

  return (
    <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(200px,240px)_minmax(420px,2fr)_minmax(260px,1fr)]">
      <HookTraceInspector
        activeHookNodeId={trace.hookNodeId}
        consumerLabel={consumerLabel}
        onSelectSiblingHook={
          onSelectHook && consumerNodeId
            ? (hookNodeId) =>
                onSelectHook({
                  consumerNodeId,
                  hookNodeId,
                  mode: "hook",
                })
            : undefined
        }
        siblingHooks={siblingHooks}
        trace={trace}
      />

      {graphSection}

      <aside className="flex h-full min-h-0 flex-col rounded-lg border bg-card">
        <div className="shrink-0 border-b px-3 py-2">
          <p className="text-xs font-semibold">Source code</p>
          {sourceTarget?.filePath ? (
            <p className="truncate font-mono text-[10px] text-muted-foreground">
              {sourceTarget.filePath}
            </p>
          ) : null}
        </div>
        <SourceCodePanel
          className="min-h-0 flex-1"
          sourceNotice={sourceNotice}
          target={sourceTarget}
        />
      </aside>
    </div>
  );
}
