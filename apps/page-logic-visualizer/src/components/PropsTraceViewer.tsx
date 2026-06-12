"use client";

import { buildUiTree } from "@cs/page-logic-visualizer/client";
import type { PageLogicGraph } from "@cs/page-logic-visualizer/client";
import { findPropFlowGraphNodeById } from "@cs/page-logic-visualizer/client";
import { useCallback, useEffect, useMemo, useState } from "react";

import { PropsTraceGraph } from "@/components/PropsTraceGraph";
import type { PropTraceGraphView } from "@/components/PropsTraceGraph";
import { PropsTraceInspector } from "@/components/PropsTraceInspector";
import { SourceCodePanel } from "@/components/SourceCodePanel";
import type { PropFlowNode } from "@/lib/propFlowGraph";
import { EMPTY_PROP_FLOW_NODES } from "@/lib/propFlowGraph";
import { buildPropInspectorView } from "@/lib/propTraceView";
import {
  pickInitialTraceStep,
  resolveTraceFocus,
  traceStepFocusMeta,
} from "@/lib/sourceView";
import type { SourceViewTarget } from "@/lib/sourceView";

interface PropsTraceViewerProps {
  graph: PageLogicGraph;
  focusNodeId: string;
  initialPropName: string;
  embedded?: boolean;
}

export function PropsTraceViewer({
  graph,
  focusNodeId,
  initialPropName,
  embedded = false,
}: PropsTraceViewerProps) {
  const uiTree = useMemo(() => buildUiTree(graph), [graph]);
  const [selectedPropName, setSelectedPropName] = useState(initialPropName);
  const [focusedFlowNodeId, setFocusedFlowNodeId] = useState<string | null>(
    null
  );
  const [sourceTarget, setSourceTarget] = useState<SourceViewTarget | null>(
    null
  );
  const [sourceNotice, setSourceNotice] = useState<string | null>(null);
  const [graphView, setGraphView] = useState<PropTraceGraphView>("upstream");

  useEffect(() => {
    setSelectedPropName(initialPropName);
  }, [focusNodeId, initialPropName]);

  useEffect(() => {
    setGraphView("upstream");
  }, [focusNodeId, selectedPropName]);

  const propView = useMemo(
    () => buildPropInspectorView(graph, focusNodeId, selectedPropName, uiTree),
    [focusNodeId, graph, selectedPropName, uiTree]
  );

  const openSourceForFlowNode = useCallback(
    (node: PropFlowNode) => {
      setFocusedFlowNodeId(node.id);
      if (node.loc) {
        setSourceNotice(null);
        setSourceTarget({
          endLine: node.loc.endLine,
          filePath: node.loc.filePath,
          label: node.label,
          searchText: node.detail,
          startLine: node.loc.startLine,
        });
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
    if (!propView) {
      return;
    }
    const initialStep = pickInitialTraceStep(propView.sourceChain, {
      consumerNodeId: focusNodeId,
      propName: selectedPropName,
    });
    if (initialStep) {
      const flowMatch = findPropFlowGraphNodeById(
        propView.upstreamFlowNodes,
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
  }, [focusNodeId, graph, openSourceForFlowNode, propView, selectedPropName]);

  if (!propView) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        Could not build prop trace for this selection.
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
      <PropsTraceInspector view={propView} />

      <PropsTraceGraph
        key={graphView}
        className="min-h-0 flex-1"
        emptyMessage={
          graphView === "upstream"
            ? "No upstream trace for this prop."
            : "No in-component usages for this prop."
        }
        flowNodes={
          graphView === "upstream"
            ? propView.upstreamFlowNodes
            : EMPTY_PROP_FLOW_NODES
        }
        focusedNodeId={focusedFlowNodeId}
        graphView={graphView}
        showTraceHint={graphView === "upstream"}
        subtitle={
          graphView === "upstream"
            ? "From this prop back to where the data is fetched or defined"
            : "Branches from this prop — pass, argument, condition, computes (same file only)"
        }
        title="Graph"
        usageGraph={
          graphView === "usage" ? propView.downstreamUsageGraph : null
        }
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
