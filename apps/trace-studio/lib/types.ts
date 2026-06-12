export type TraceNodeType =
  | "route"
  | "page"
  | "layout"
  | "loading"
  | "error"
  | "not_found"
  | "component"
  | "hook"
  | "service"
  | "store"
  | "api"
  | "file"
  | "function"
  | "external"
  | "builtin"
  | "prop"
  | "variable";

import type { ExecutionStepRecord } from "@ai-trace/types";

export type TraceViewMode = "component" | "full";

export interface ComponentChildRef {
  id: string;
  label: string;
  filePath?: string;
  props?: string;
  edgeType: string;
}

export type InspectorItemKind =
  | "declared_prop"
  | "received_prop"
  | "prop_origin"
  | "passed_prop"
  | "parent"
  | "variable"
  | "hook"
  | "call"
  | "execution"
  | "child";

export interface InspectorItem {
  id: string;
  kind: InspectorItemKind;
  label: string;
  subtitle?: string;
  line?: number;
  filePath?: string;
  startLine?: number;
  endLine?: number;
  /** Data-flow graph focus key (prop name, hook name, etc.) */
  focus?: string;
  focusKind?: "prop" | "hook" | "call" | "execution";
  targetNodeId?: string;
}

export interface TraceNodeBadge {
  calls: number;
  children: number;
  hooks: number;
}

export interface TraceNode {
  id: string;
  label: string;
  type: TraceNodeType;
  filePath?: string;
  startLine?: number;
  endLine?: number;
  traceable: boolean;
  metadata?: {
    props?: string[];
    renders?: string[];
    usesHooks?: string[];
    calls?: string[];
    usedBy?: string[];
    propsReceived?: string[];
    propOrigins?: string[];
    callChain?: string[];
    executionSteps?: ExecutionStepRecord[];
    children?: ComponentChildRef[];
    passedToChildren?: string[];
    badge?: TraceNodeBadge;
    inspectorItems?: InspectorItem[];
    isPropSink?: boolean;
    ownerComponentId?: string;
    ownerLabel?: string;
    line?: number;
    stepKind?: string;
  };
}

export interface TraceEdge {
  id: string;
  from: string;
  to: string;
  type: string;
  label?: string;
  metadata?: {
    order?: number;
    sequenceRank?: number;
    stepKind?: string;
    line?: number;
    propName?: string;
    callee?: string;
    passedFrom?: string;
  };
}

export interface SourceSnippet {
  filePath: string;
  startLine: number;
  endLine: number;
  code: string;
}

export interface DataFlowGraphResponse {
  /** Owning component (context only, not graph focus). */
  centerNode: TraceNode;
  nodes: TraceNode[];
  edges: TraceEdge[];
  focusLabel?: string;
  /** Highlighted node in the graph (prop sink when tracing props). */
  focusNodeId?: string;
  /** Virtual sink node id for the selected prop. */
  propSinkId?: string;
}

export interface TraceGraphResponse {
  scope: string;
  centerNode: TraceNode;
  nodes: TraceNode[];
  edges: TraceEdge[];
  dataFlow?: DataFlowGraphResponse;
  source?: SourceSnippet;
  view?: TraceViewMode;
}

export interface ScopeItem {
  id: string;
  type: "app" | "package" | "workspace";
  label: string;
}

export interface SearchResultItem {
  id: string;
  label: string;
  type: string;
  filePath?: string;
  startLine?: number;
  endLine?: number;
  traceable: boolean;
}
