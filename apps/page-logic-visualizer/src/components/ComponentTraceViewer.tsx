"use client";

import type {
  DataTraceChain,
  HookTraceView,
  LogicGraphNode,
  PageLogicGraph,
  UiLocalItem,
} from "@cs/page-logic-visualizer/client";

import type { LocalItemTone, TraceStepFocusMeta } from "@/lib/sourceView";

import type { HookTraceRequest } from "./UiGraphViewer";
import { UiGraphViewer } from "./UiGraphViewer";

interface ComponentTraceViewerProps {
  graph: PageLogicGraph;
  focusNodeId: string;
  selectedNodeId: string | null;
  search: string;
  expandingNodeId: string | null;
  activeTrace: DataTraceChain | null;
  onSelectNode: (nodeId: string) => void;
  onOpenSourceNode: (nodeId: string, traceMeta?: TraceStepFocusMeta) => void;
  onOpenSourceLocal: (
    consumerNodeId: string,
    item: UiLocalItem,
    tone: LocalItemTone
  ) => void;
  onExpandNode: (node: LogicGraphNode) => void | Promise<void>;
  onTraceData: (
    expression: string,
    consumerNodeId: string,
    options?: { propName?: string; variableName?: string }
  ) => void;
  onTraceHook: (
    request: HookTraceRequest
  ) => void | Promise<void> | Promise<HookTraceView | undefined>;
  onFocusNodeChange: (nodeId: string) => void;
}

export function ComponentTraceViewer({
  graph,
  focusNodeId,
  selectedNodeId,
  search,
  expandingNodeId,
  activeTrace,
  onSelectNode,
  onOpenSourceNode,
  onOpenSourceLocal,
  onExpandNode,
  onTraceData,
  onTraceHook,
  onFocusNodeChange,
}: ComponentTraceViewerProps) {
  return (
    <UiGraphViewer
      activeTrace={activeTrace}
      expandingNodeId={expandingNodeId}
      focusRootId={focusNodeId}
      graph={graph}
      onExpandNode={onExpandNode}
      onFocusRootChange={onFocusNodeChange}
      onOpenSourceLocal={onOpenSourceLocal}
      onOpenSourceNode={onOpenSourceNode}
      onSelectNode={onSelectNode}
      onTraceData={onTraceData}
      onTraceHook={onTraceHook}
      search={search}
      selectedNodeId={selectedNodeId}
    />
  );
}
