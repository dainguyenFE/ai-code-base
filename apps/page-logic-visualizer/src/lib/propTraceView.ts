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
  flattenUiTree,
  resolveImmediatePropExpression,
  resolvePropDataExpression,
} from "@cs/page-logic-visualizer/client";

import { matchesPropUsage } from "@/lib/propExpressionMatch";
import type {
  PropFlowBranchGroup,
  PropFlowNode,
  PropFlowParallelGroup,
} from "@/lib/propFlowGraph";
import {
  buildDownstreamUsageFlowGraph,
  collectInComponentJsxPasses,
} from "@/lib/propUsageFlow";
import type { PropPassDown, UsageFlowGraph } from "@/lib/propUsageFlow";

export type { PropFlowBranchGroup, PropFlowNode, PropFlowParallelGroup };
export type { PropPassDown, UsageFlowGraph };

export type PropUsageKind =
  | "condition"
  | "loop"
  | "event"
  | "variable"
  | "render";

export interface PropUsageSite {
  kind: PropUsageKind;
  label: string;
  detail?: string;
  nodeId?: string;
}

export interface PropInspectorView {
  propName: string;
  componentNodeId: string;
  componentLabel: string;
  expression: string;
  propKind?: string;
  sourceChain: DataTraceChain;
  /** Origin trace — consumer up to data source */
  upstreamFlowNodes: PropFlowNode[];
  /** In-component usage — fork from prop to sibling branches */
  downstreamUsageGraph: UsageFlowGraph | null;
  usedIn: PropUsageSite[];
  passedTo: PropPassDown[];
}

const extractTracedFieldPath = (
  dataExpression: string,
  propName: string
): string => {
  if (dataExpression.includes(".")) {
    const parts = dataExpression.split(".");
    return parts.slice(1).join(".") || propName;
  }
  return propName;
};

export { referencesIdentifier } from "@/lib/propExpressionMatch";

export const collectSymbolUsagesInTree = (
  treeNode: UiTreeNode,
  propName: string,
  dataExpression?: string
): PropUsageSite[] => {
  const sites: PropUsageSite[] = [];
  const matchExpr = (expression: string): boolean =>
    matchesPropUsage(expression, propName, dataExpression);

  const { node } = treeNode;

  if (node.loop && matchExpr(node.loop.sourceExpression)) {
    sites.push({
      detail: node.loop.itemName ? `item: ${node.loop.itemName}` : undefined,
      kind: "loop",
      label: node.loop.sourceExpression,
      nodeId: node.id,
    });
  }

  if (
    node.condition &&
    node.condition.inputs?.some((input) => matchExpr(input))
  ) {
    sites.push({
      kind: "condition",
      label: node.condition.expression,
      nodeId: node.id,
    });
  }

  for (const gate of treeNode.gateConditions) {
    if (gate.inputs.some((input) => matchExpr(input))) {
      sites.push({
        kind: "condition",
        label: gate.expression,
        nodeId: gate.conditionNodeId,
      });
    }
  }

  for (const local of treeNode.localConditions) {
    if (local.inputs.some((input) => matchExpr(input))) {
      sites.push({
        kind: "condition",
        label: local.expression,
        nodeId: local.conditionNodeId,
      });
    }
  }

  for (const variable of treeNode.locals.variables) {
    if (variable.expression && matchExpr(variable.expression)) {
      sites.push({
        detail: variable.expression,
        kind: "variable",
        label: variable.name,
      });
    }
  }

  for (const fn of treeNode.locals.functions) {
    if (fn.expression && matchExpr(fn.expression)) {
      sites.push({
        detail: fn.expression,
        kind: "event",
        label: fn.name,
      });
    }
  }

  for (const render of treeNode.renders) {
    for (const prop of render.props) {
      if (/^on[A-Z]/.test(prop.name) && matchExpr(prop.expression)) {
        sites.push({
          detail: prop.expression,
          kind: "event",
          label: `${render.label}.${prop.name}`,
          nodeId: render.nodeId,
        });
      }
    }
  }

  return sites;
};

const collectPassedTo = (
  graph: PageLogicGraph,
  treeNode: UiTreeNode,
  componentNodeId: string,
  propName: string,
  dataExpression?: string
): PropPassDown[] =>
  collectInComponentJsxPasses(
    graph,
    treeNode,
    componentNodeId,
    propName,
    dataExpression
  );

export const listComponentProps = (
  graph: PageLogicGraph,
  componentNodeId: string,
  uiTree: UiTreeNode | null
): { name: string; expression?: string; kind?: string }[] => {
  const treeNode = uiTree ? findUiTreeNode(uiTree, componentNodeId) : null;
  if (treeNode) {
    return treeNode.locals.props.map((item) => ({
      expression:
        item.expression ??
        resolvePropDataExpression(graph, componentNodeId, item.name),
      name: item.name,
    }));
  }

  const node = graph.nodes.find((item) => item.id === componentNodeId);
  return (node?.props ?? []).map((prop) => ({
    expression: prop.expression,
    kind: prop.kind,
    name: prop.name,
  }));
};

export const buildPropInspectorView = (
  graph: PageLogicGraph,
  componentNodeId: string,
  propName: string,
  uiTree?: UiTreeNode | null
): PropInspectorView | undefined => {
  const tree = uiTree ?? buildUiTree(graph);
  const treeNode = tree ? findUiTreeNode(tree, componentNodeId) : null;
  const node = graph.nodes.find((item) => item.id === componentNodeId);
  if (!node) {
    return undefined;
  }

  const expression =
    resolveImmediatePropExpression(graph, componentNodeId, propName) ??
    resolvePropDataExpression(graph, componentNodeId, propName) ??
    propName;

  const propMeta = (node.props ?? []).find((prop) => prop.name === propName);

  const sourceChain = buildDataTraceChain(
    graph,
    propName,
    componentNodeId,
    tree,
    {
      propName,
    }
  );

  const dataExpression =
    resolvePropDataExpression(graph, componentNodeId, propName) ?? expression;

  const fieldPath = extractTracedFieldPath(dataExpression, propName);

  const upstreamFlowNodes = buildLinearPropFlowGraph(graph, sourceChain, {
    fieldPath,
  });

  const usedIn = treeNode
    ? collectSymbolUsagesInTree(treeNode, propName, dataExpression)
    : [];

  const passedTo = treeNode
    ? collectPassedTo(
        graph,
        treeNode,
        componentNodeId,
        propName,
        dataExpression
      )
    : [];

  const downstreamUsageGraph = treeNode
    ? buildDownstreamUsageFlowGraph(
        graph,
        componentNodeId,
        propName,
        expression,
        treeNode,
        dataExpression
      )
    : null;

  return {
    componentLabel: node.label,
    componentNodeId,
    downstreamUsageGraph,
    expression,
    passedTo,
    propKind: propMeta?.kind,
    propName,
    sourceChain,
    upstreamFlowNodes,
    usedIn,
  };
};

export const filterPropsBySearch = (
  props: { name: string }[],
  search: string
): { name: string }[] => {
  const query = search.trim().toLowerCase();
  if (!query) {
    return props;
  }
  return props.filter((prop) => prop.name.toLowerCase().includes(query));
};

export const listExplorerComponents = (
  uiTree: UiTreeNode | null,
  focusNodeId: string
): UiTreeNode[] => {
  if (!uiTree) {
    return [];
  }
  const focusNode = findUiTreeNode(uiTree, focusNodeId) ?? uiTree;
  const childComponents = focusNode.children.filter(
    (child) =>
      child.node.type === "component" ||
      child.node.type === "page" ||
      child.locals.props.length > 0
  );
  return [focusNode, ...childComponents];
};

/** First component (from start node downward) that declares JSX props. */
export const findFirstComponentWithProps = (
  graph: PageLogicGraph,
  uiTree: UiTreeNode | null,
  startNodeId: string,
  search = ""
): { nodeId: string; propName: string } | null => {
  if (!uiTree) {
    return null;
  }

  const flat = flattenUiTree(uiTree);
  const startIndex = flat.findIndex((node) => node.nodeId === startNodeId);
  const ordered =
    startIndex !== -1
      ? [...flat.slice(startIndex), ...flat.slice(0, startIndex)]
      : flat;

  const componentScore = (treeNode: UiTreeNode): number => {
    const path = treeNode.node.filePath ?? "";
    if (path.includes("page-logic-demo")) {
      return 100;
    }
    if (treeNode.node.label === "JsonLdScript") {
      return -10;
    }
    if (path.includes("/packages/seo/")) {
      return -5;
    }
    return treeNode.locals.props.length;
  };

  const ranked = [...ordered].toSorted(
    (a, b) => componentScore(b) - componentScore(a)
  );

  if (!search.trim()) {
    for (const treeNode of ranked) {
      const props = listComponentProps(graph, treeNode.nodeId, uiTree);
      const plans = props.find((prop) => prop.name === "plans");
      if (plans) {
        return { nodeId: treeNode.nodeId, propName: plans.name };
      }
    }
  }

  for (const treeNode of ranked) {
    const props = filterPropsBySearch(
      listComponentProps(graph, treeNode.nodeId, uiTree),
      search
    );
    if (props.length > 0 && componentScore(treeNode) >= 0) {
      return { nodeId: treeNode.nodeId, propName: props[0]!.name };
    }
  }

  for (const treeNode of ranked) {
    const props = filterPropsBySearch(
      listComponentProps(graph, treeNode.nodeId, uiTree),
      search
    );
    if (props.length > 0) {
      return { nodeId: treeNode.nodeId, propName: props[0]!.name };
    }
  }

  return null;
};
