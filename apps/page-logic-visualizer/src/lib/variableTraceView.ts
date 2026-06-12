import type {
  DataTraceChain,
  PageLogicGraph,
  UiTreeNode,
} from "@cs/page-logic-visualizer/client";
import {
  buildDataTraceChain,
  buildLinearPropFlowGraph,
  buildUiTree,
  findUiTreeNode,
} from "@cs/page-logic-visualizer/client";

import type { PropFlowNode } from "@/lib/propFlowGraph";
import { collectSymbolUsagesInTree } from "@/lib/propTraceView";
import type { PropUsageSite } from "@/lib/propTraceView";
import { buildDownstreamUsageFlowGraph } from "@/lib/propUsageFlow";
import type { UsageFlowGraph } from "@/lib/propUsageFlow";
import type { SourceViewTarget } from "@/lib/sourceView";

export interface VariableInspectorView {
  variableName: string;
  componentNodeId: string;
  componentLabel: string;
  expression: string;
  sourceHook?: string;
  sourceChain: DataTraceChain;
  /** Origin trace — variable back to prop, hook, function, or fetch */
  upstreamFlowNodes: PropFlowNode[];
  /** In-component usage — fork from variable to sibling branches */
  downstreamUsageGraph: UsageFlowGraph | null;
  usedIn: PropUsageSite[];
}

const resolveFieldPathFromChain = (
  chain: DataTraceChain,
  variableName: string
): string | undefined => {
  const propStep = chain.steps.find(
    (step) => step.stepRole === "prop" && step.label !== variableName
  );
  if (propStep) {
    const { label } = propStep;
    return label.includes(".")
      ? label.split(".").slice(1).join(".") || label
      : label;
  }

  const upstreamVariable = chain.steps.find(
    (step) =>
      step.stepRole === "variable" &&
      step.label !== variableName &&
      step.label !== "data"
  );
  if (upstreamVariable) {
    return upstreamVariable.label;
  }

  return undefined;
};

export const buildVariableInspectorView = (
  graph: PageLogicGraph,
  componentNodeId: string,
  variableName: string,
  uiTree?: UiTreeNode | null,
  upstreamFlowNodesOverride?: PropFlowNode[]
): VariableInspectorView | undefined => {
  const tree = uiTree ?? buildUiTree(graph);
  const treeNode = tree ? findUiTreeNode(tree, componentNodeId) : null;
  const node = graph.nodes.find((item) => item.id === componentNodeId);
  if (!node) {
    return undefined;
  }

  const localItem = treeNode?.locals.variables.find(
    (item) => item.name === variableName
  );
  const expression = localItem?.expression ?? variableName;

  const sourceChain = buildDataTraceChain(
    graph,
    variableName,
    componentNodeId,
    tree
  );

  const fieldPath = resolveFieldPathFromChain(sourceChain, variableName);
  const upstreamFlowNodes =
    upstreamFlowNodesOverride ??
    buildLinearPropFlowGraph(graph, sourceChain, { fieldPath });

  const usedIn = treeNode
    ? collectSymbolUsagesInTree(treeNode, variableName, variableName)
    : [];

  const downstreamUsageGraph = treeNode
    ? buildDownstreamUsageFlowGraph(
        graph,
        componentNodeId,
        variableName,
        expression,
        treeNode,
        variableName,
        { intakeKind: "variable" }
      )
    : null;

  return {
    componentLabel: node.label,
    componentNodeId,
    downstreamUsageGraph,
    expression,
    sourceChain,
    sourceHook: localItem?.sourceHook,
    upstreamFlowNodes,
    usedIn,
    variableName,
  };
};

const toRepoRelativePath = (filePath: string): string => {
  const normalized = filePath.replaceAll("\\", "/");
  const appsIndex = normalized.indexOf("apps/");
  if (appsIndex !== -1) {
    return normalized.slice(appsIndex);
  }
  const packagesIndex = normalized.indexOf("packages/");
  if (packagesIndex !== -1) {
    return normalized.slice(packagesIndex);
  }
  return normalized;
};

export const sourceTargetForVariableUsage = (
  label: string,
  filePath?: string,
  line?: number
): SourceViewTarget | null => {
  if (!filePath) {
    return null;
  }

  return {
    endLine: line,
    filePath: toRepoRelativePath(filePath),
    label,
    searchText: line ? undefined : label,
    startLine: line,
  };
};
