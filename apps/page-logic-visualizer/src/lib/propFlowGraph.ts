import type { PropFlowGraphNode } from "@cs/page-logic-visualizer/client";

export type PropFlowNode = PropFlowGraphNode;

export interface PropFlowParallelBranch {
  entryTransition?: string;
  steps: PropFlowNode[];
}

export type PropFlowParallelGroup = NonNullable<
  PropFlowGraphNode["parallelGroup"]
>;

export type PropFlowBranchGroup = NonNullable<PropFlowGraphNode["branchGroup"]>;

/** Stable empty list — avoid `flowNodes={[]}` / default `[]` retriggering graph layout every render. */
export const EMPTY_PROP_FLOW_NODES: PropFlowNode[] = [];
