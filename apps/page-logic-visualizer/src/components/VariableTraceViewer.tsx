"use client";

import {
  buildUiTree,
  isStoreBackedLocal,
} from "@cs/page-logic-visualizer/client";
import type { PageLogicGraph } from "@cs/page-logic-visualizer/client";
import { findPropFlowGraphNodeById } from "@cs/page-logic-visualizer/client";
import { useCallback, useEffect, useMemo, useState } from "react";

import { PropsTraceGraph } from "@/components/PropsTraceGraph";
import type { PropTraceGraphView } from "@/components/PropsTraceGraph";
import { SourceCodePanel } from "@/components/SourceCodePanel";
import { VariableTraceInspector } from "@/components/VariableTraceInspector";
import { resolveHookFlowNodeFocus } from "@/lib/hookTraceSource";
import type { PropFlowNode } from "@/lib/propFlowGraph";
import { EMPTY_PROP_FLOW_NODES } from "@/lib/propFlowGraph";
import type { UsageFlowGraph } from "@/lib/propUsageFlow";
import {
  pickInitialTraceStep,
  resolveTraceFocus,
  sourceTargetFromLocation,
  traceStepFocusMeta,
} from "@/lib/sourceView";
import type { SourceViewTarget } from "@/lib/sourceView";
import { buildVariableInspectorView } from "@/lib/variableTraceView";

interface VariableTraceViewerProps {
  graph: PageLogicGraph;
  focusNodeId: string;
  initialVariableName: string;
  embedded?: boolean;
}

export function VariableTraceViewer({
  graph,
  focusNodeId,
  initialVariableName,
  embedded = false,
}: VariableTraceViewerProps) {
  const uiTree = useMemo(() => buildUiTree(graph), [graph]);
  const [upstreamFlowNodes, setUpstreamFlowNodes] = useState<PropFlowNode[]>(
    []
  );
  const [traceLoading, setTraceLoading] = useState(false);
  const [focusedFlowNodeId, setFocusedFlowNodeId] = useState<string | null>(
    null
  );
  const [sourceTarget, setSourceTarget] = useState<SourceViewTarget | null>(
    null
  );
  const [sourceNotice, setSourceNotice] = useState<string | null>(null);
  const [graphView, setGraphView] = useState<PropTraceGraphView>("upstream");
  const [writerGraph, setWriterGraph] = useState<UsageFlowGraph | null>(null);
  const [writersLoading, setWritersLoading] = useState(false);

  useEffect(() => {
    setSourceTarget(null);
    setSourceNotice(null);
    setFocusedFlowNodeId(null);
    setGraphView("upstream");
    setWriterGraph(null);
  }, [focusNodeId, initialVariableName]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setTraceLoading(true);
      try {
        const response = await fetch("/api/analyze/variable-trace", {
          body: JSON.stringify({
            consumerNodeId: focusNodeId,
            graph,
            variableName: initialVariableName,
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });
        const payload = (await response.json()) as {
          flowNodes?: PropFlowNode[];
          error?: string;
        };
        if (!cancelled) {
          setUpstreamFlowNodes(payload.flowNodes ?? []);
        }
      } catch {
        if (!cancelled) {
          setUpstreamFlowNodes([]);
        }
      } finally {
        if (!cancelled) {
          setTraceLoading(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [focusNodeId, graph, initialVariableName]);

  const variableView = useMemo(
    () =>
      buildVariableInspectorView(
        graph,
        focusNodeId,
        initialVariableName,
        uiTree,
        upstreamFlowNodes.length > 0 ? upstreamFlowNodes : undefined
      ),
    [focusNodeId, graph, initialVariableName, uiTree, upstreamFlowNodes]
  );

  const isStoreVariable = useMemo(
    () => isStoreBackedLocal(initialVariableName, variableView?.sourceHook),
    [initialVariableName, variableView?.sourceHook]
  );

  useEffect(() => {
    if (!isStoreVariable || !variableView) {
      setWriterGraph(null);
      return;
    }

    let cancelled = false;
    const load = async () => {
      setWritersLoading(true);
      try {
        const response = await fetch("/api/analyze/store-writers", {
          body: JSON.stringify({
            graph,
            storeField: initialVariableName,
            storeHook: variableView.sourceHook,
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });
        const payload = (await response.json()) as {
          writerGraph?: UsageFlowGraph;
          error?: string;
        };
        if (!cancelled) {
          setWriterGraph(payload.writerGraph ?? null);
        }
      } catch {
        if (!cancelled) {
          setWriterGraph(null);
        }
      } finally {
        if (!cancelled) {
          setWritersLoading(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [graph, initialVariableName, isStoreVariable, variableView?.sourceHook]);

  const openSourceForFlowNode = useCallback(
    (node: PropFlowNode) => {
      setFocusedFlowNodeId(node.id);

      if (node.hookTrace) {
        const { notice, target } = resolveHookFlowNodeFocus(
          graph,
          node.hookTrace,
          node
        );
        setSourceNotice(notice);
        setSourceTarget(target);
        return;
      }

      if (node.loc) {
        setSourceNotice(null);
        setSourceTarget(sourceTargetFromLocation(node.loc, node.label));
        return;
      }

      if (node.nodeId) {
        const { notice, target } = resolveTraceFocus(graph, node.nodeId);
        setSourceNotice(notice);
        setSourceTarget(target);
      }
    },
    [graph]
  );

  useEffect(() => {
    if (!variableView || traceLoading || graphView !== "upstream") {
      return;
    }
    const initialStep = pickInitialTraceStep(variableView.sourceChain, {
      consumerNodeId: focusNodeId,
      propName: initialVariableName,
    });
    if (initialStep) {
      const flowMatch = findPropFlowGraphNodeById(
        variableView.upstreamFlowNodes,
        initialStep.nodeId
      );
      if (flowMatch) {
        openSourceForFlowNode(flowMatch);
        return;
      }
      const { notice, target } = resolveTraceFocus(
        graph,
        initialStep.nodeId,
        traceStepFocusMeta(initialStep)
      );
      setSourceNotice(notice);
      setSourceTarget(target);
      setFocusedFlowNodeId(initialStep.nodeId);
    }
  }, [
    focusNodeId,
    graph,
    graphView,
    initialVariableName,
    openSourceForFlowNode,
    traceLoading,
    variableView,
  ]);

  const hookExpandIds = useMemo(() => {
    const hookNode = upstreamFlowNodes.find(
      (node) => node.traceable && node.stepRole === "hook"
    );
    if (!hookNode?.expandableSteps?.length) {
      return;
    }

    const ids = new Set<string>([hookNode.id]);
    for (const section of hookNode.expandableSteps) {
      ids.add(section.id);
    }
    ids.add(`return:${initialVariableName}`);
    return [...ids];
  }, [initialVariableName, upstreamFlowNodes]);

  if (!variableView) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        Could not build variable trace for this selection.
      </p>
    );
  }

  return (
    <div
      className={
        embedded
          ? "grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(200px,240px)_minmax(420px,2fr)_minmax(260px,1fr)]"
          : "grid h-[calc(100vh-11rem)] min-h-[480px] gap-3 lg:grid-cols-[minmax(220px,260px)_minmax(440px,2fr)_minmax(280px,1fr)]"
      }
    >
      <VariableTraceInspector view={variableView} />

      <PropsTraceGraph
        key={`${focusNodeId}:${initialVariableName}:${upstreamFlowNodes.map((node) => node.id).join("|")}`}
        className="min-h-0 flex-1"
        emptyMessage={
          graphView === "upstream"
            ? (traceLoading
              ? "Loading upstream trace…"
              : "No upstream trace for this variable.")
            : graphView === "writers"
              ? writersLoading
                ? "Loading store writers on this route…"
                : "No writers for this store field on the current route."
              : "No in-component usages for this variable."
        }
        flowNodes={
          graphView === "upstream"
            ? variableView.upstreamFlowNodes
            : EMPTY_PROP_FLOW_NODES
        }
        focusedNodeId={focusedFlowNodeId}
        graphView={graphView}
        initialTracedNodeIds={
          graphView === "upstream" ? hookExpandIds : undefined
        }
        showTraceHint={graphView === "upstream"}
        showWritersTab={isStoreVariable}
        subtitle={
          graphView === "upstream"
            ? "From this variable back to prop, hook, function, or data fetch"
            : (graphView === "writers"
              ? "Arrows into this store field — only sources on the current route (page-scoped)"
              : "Branches from this variable — pass, argument, condition, computes (same file only)")
        }
        title="Graph"
        usageGraph={
          graphView === "usage" ? variableView.downstreamUsageGraph : null
        }
        writerGraph={graphView === "writers" ? writerGraph : null}
        onGraphViewChange={setGraphView}
        onSelectNode={openSourceForFlowNode}
      />

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
