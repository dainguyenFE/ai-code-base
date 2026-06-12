import type { PropFlowNode } from "@/lib/propFlowGraph";

const isTraceable = (node: PropFlowNode): boolean =>
  Boolean(node.traceable && node.expandableSteps?.length);

/** All traceable node ids from `root` downward (inclusive). */
export const collectTraceExpandAllIds = (root: PropFlowNode): string[] => {
  const ids = new Set<string>();

  const visitDeep = (node: PropFlowNode) => {
    if (isTraceable(node)) {
      ids.add(node.id);
      for (const step of node.expandableSteps ?? []) {
        visitDeep(step);
      }
    }

    node.nestedSteps?.forEach(visitDeep);
    node.branchGroup?.branches.forEach((branch) =>
      branch.steps.forEach(visitDeep)
    );
    node.parallelGroup?.branches.forEach((branch) =>
      branch.steps.forEach(visitDeep)
    );
  };

  visitDeep(root);
  return [...ids];
};

/** Traceable ids across the full prop-flow spine (top-level steps). */
export const collectSpineExpandAllIds = (
  flowNodes: PropFlowNode[]
): string[] => {
  const ids = new Set<string>();
  for (const node of flowNodes) {
    for (const id of collectTraceExpandAllIds(node)) {
      ids.add(id);
    }
  }
  return [...ids];
};

export const countTraceableInSubtree = (root: PropFlowNode): number =>
  collectTraceExpandAllIds(root).length;
