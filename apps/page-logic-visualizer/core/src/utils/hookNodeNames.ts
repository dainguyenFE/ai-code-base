import type { LogicGraphNode } from "../types";

const CALL_EXPR_NAME = /^(\w+)\s*\(/;

const hookNameFromCallExpression = (
  callExpression: string | undefined
): string | undefined => callExpression?.match(CALL_EXPR_NAME)?.[1];

const hookNameFromPrefixedLabel = (label: string): string | undefined => {
  const separatorIndex = label.indexOf(": ");
  if (separatorIndex === -1) {
    return undefined;
  }
  const name = label.slice(separatorIndex + 2).trim();
  return name.length > 0 ? name : undefined;
};

/** Resolve the hook call identifier (e.g. useDemoUiStore) from a graph node. */
export const hookCallNameFromGraphNode = (
  node: LogicGraphNode
): string | undefined => {
  if (node.type === "hook") {
    return node.hook?.hookName ?? node.label;
  }

  if (node.type === "store") {
    return (
      hookNameFromCallExpression(node.store?.callExpression) ??
      hookNameFromPrefixedLabel(node.label) ??
      (/^use[A-Z]/.test(node.store?.storeName ?? "")
        ? node.store?.storeName
        : undefined)
    );
  }

  if (node.type === "context") {
    return (
      hookNameFromCallExpression(node.context?.callExpression) ??
      hookNameFromPrefixedLabel(node.label)
    );
  }

  return /^use[A-Z]/.test(node.label) ? node.label : undefined;
};

export const graphNodeMatchesHookCallName = (
  node: LogicGraphNode,
  hookCallName: string
): boolean => hookCallNameFromGraphNode(node) === hookCallName;
