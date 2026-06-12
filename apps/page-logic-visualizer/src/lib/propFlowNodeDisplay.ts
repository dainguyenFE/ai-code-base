import type { PropFlowNode } from "@/lib/propFlowGraph";

const CODE_PREVIEW_ROLES = new Set([
  "assign",
  "return",
  "literal",
  "variable",
  "call",
  "await-call",
  "api-call",
]);

const CODE_PREVIEW_MAX_CHARS = 40;

/** Long labels (return/assign expressions) render as a single truncated code line. */
export const shouldShowCodePreview = (flowNode: PropFlowNode): boolean => {
  const role = flowNode.stepRole;
  if (role && CODE_PREVIEW_ROLES.has(role)) {
    return true;
  }
  const label = flowNode.label.trim();
  return label.length > CODE_PREVIEW_MAX_CHARS || label.includes("\n");
};

export const getCodePreviewText = (flowNode: PropFlowNode): string =>
  flowNode.label.replaceAll(/\s+/g, " ").trim();

export const getNodeHeadline = (flowNode: PropFlowNode): string => {
  if (flowNode.stepRole === "await-join") {
    return "Await";
  }
  if (shouldShowCodePreview(flowNode)) {
    return "";
  }
  return flowNode.label;
};
