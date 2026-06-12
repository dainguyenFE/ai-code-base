import type {
  DataFetchCallTreeNode,
  DataSourceKind,
  LogicGraphNode,
  ModuleBindingMeta,
  PageLogicGraph,
  PropUsage,
  SourceLocation,
  UiLocalItem,
  UiLocalsMeta,
} from "../types";
import { graphNodeMatchesHookCallName } from "../utils/hookNodeNames";
import { isCustomHookName, isReactBuiltInHook } from "../utils/reactHooks";
import {
  htmlTagFromNodeLabel,
  isHtmlLayoutWrapperTag,
  isSemanticHtmlTag,
} from "../utils/semanticHtml";
import {
  buildNodeContext,
  collectPropPassThroughSteps,
  resolveCallSitePropExpression,
  resolveConsumerAnchorId,
  resolveExpressionToNode,
  resolveImmediatePropLoc,
  resolvePropDataExpression,
} from "./trace";

const UI_NODE_TYPES = new Set(["route", "layout", "page", "component"]);

const UI_CHILD_EDGE_TYPES = new Set([
  "renders",
  "condition-true",
  "condition-false",
  "loop-renders",
]);

export type UiHtmlVisibilityMode = "semantic" | "all";

export interface BuildUiTreeOptions {
  /**
   * semantic — components + semantic HTML + HTML subtrees with variables/loops (default)
   * all — every HTML node in the graph, including div/span wrappers
   */
  htmlVisibility?: UiHtmlVisibilityMode;
}

const isHtmlGraphNode = (node: LogicGraphNode): boolean =>
  node.metadata?.isHtml === true ||
  htmlTagFromNodeLabel(node.label) !== undefined;

const isSemanticHtmlGraphNode = (node: LogicGraphNode): boolean => {
  if (node.metadata?.isSemanticHtml === true) {
    return true;
  }
  if (node.metadata?.isHtmlWrapper === true) {
    return false;
  }
  const tag = htmlTagFromNodeLabel(node.label);
  return tag ? isSemanticHtmlTag(tag) : false;
};

const htmlSubtreeDependsOnVariables = (
  graph: PageLogicGraph,
  nodeId: string,
  byId: Map<string, LogicGraphNode>,
  visiting = new Set<string>()
): boolean => {
  if (visiting.has(nodeId)) {
    return false;
  }
  visiting.add(nodeId);

  const node = byId.get(nodeId);
  if (!node) {
    return false;
  }

  if (node.type === "loop") {
    return true;
  }

  if (
    node.props?.some(
      (prop) => prop.kind !== "literal" && prop.expression.trim().length > 0
    )
  ) {
    return true;
  }

  if (
    node.type === "ui-content" &&
    /\{[^}]+\}/.test(node.uiContent?.preview ?? "")
  ) {
    return true;
  }

  for (const edge of graph.edges) {
    if (edge.source !== nodeId) {
      continue;
    }
    if (
      edge.type !== "renders" &&
      edge.type !== "loop-renders" &&
      edge.type !== "condition-true" &&
      edge.type !== "condition-false"
    ) {
      continue;
    }
    const child = byId.get(edge.target);
    if (!child) {
      continue;
    }
    if (!isHtmlGraphNode(child) && isUiGraphNode(child)) {
      return true;
    }
    if (htmlSubtreeDependsOnVariables(graph, child.id, byId, visiting)) {
      return true;
    }
  }

  return false;
};

/** Flatten pass-through nodes so children promote to the nearest visible parent. */
const shouldFlattenHtmlNode = (
  node: LogicGraphNode,
  graph: PageLogicGraph,
  mode: UiHtmlVisibilityMode,
  byId: Map<string, LogicGraphNode>
): boolean => {
  if (!isHtmlGraphNode(node)) {
    return false;
  }
  if (mode === "all") {
    return false;
  }
  if (node.metadata?.isHtmlWrapper === true) {
    return true;
  }
  const tag = htmlTagFromNodeLabel(node.label);
  if (tag && isHtmlLayoutWrapperTag(tag)) {
    return true;
  }
  if (isSemanticHtmlGraphNode(node)) {
    return false;
  }
  return !htmlSubtreeDependsOnVariables(graph, node.id, byId);
};

const flattenHtmlSubtree = ({
  graph,
  htmlNode,
  incomingGate,
  mode,
  visited,
}: {
  graph: PageLogicGraph;
  htmlNode: LogicGraphNode;
  incomingGate?: UiGateCondition;
  mode: UiHtmlVisibilityMode;
  visited: Set<string>;
}): { children: UiTreeNode[]; renders: UiRenderItem[] } => {
  const byId = nodesById(graph);
  const children: UiTreeNode[] = [];
  const renders: UiRenderItem[] = [];

  for (const edge of outgoingEdges(graph, htmlNode.id)) {
    if (!UI_CHILD_EDGE_TYPES.has(edge.type)) {
      continue;
    }
    const through = byId.get(edge.target);
    if (!through || !isUiGraphNode(through)) {
      continue;
    }

    if (shouldFlattenHtmlNode(through, graph, mode, byId)) {
      const nested = flattenHtmlSubtree({
        graph,
        htmlNode: through,
        incomingGate,
        mode,
        visited,
      });
      children.push(...nested.children);
      renders.push(...nested.renders);
      continue;
    }

    renders.push({
      edgeLabel: edge.label,
      edgeType: edge.type,
      label: through.label,
      nodeId: through.id,
      props: through.props ?? [],
      type: through.type,
    });
    const uiChild = buildUiSubtree(
      graph,
      through.id,
      visited,
      incomingGate,
      mode
    );
    if (uiChild) {
      children.push(uiChild);
    }
  }

  return { children, renders };
};

export interface UiRenderItem {
  nodeId: string;
  label: string;
  type: string;
  props: PropUsage[];
  edgeType: string;
  edgeLabel?: string;
}

export interface UiDataItem {
  id: string;
  /** Short display name, e.g. variable `data` not function `getDemoPageData` */
  name: string;
  label: string;
  expression: string;
  kind: DataSourceKind;
  nodeId?: string;
}

export type DataTraceStepRole =
  | "prop"
  | "variable"
  | "await-call"
  | "function"
  | "promise-all"
  | "api-call"
  | "hardcode"
  | "literal"
  | "hook"
  | "context"
  | "store";

export interface UiGateCondition {
  conditionNodeId: string;
  expression: string;
  branch: "true" | "false";
  inputs: string[];
  loc?: SourceLocation;
}

const emptyLocals = (): UiLocalsMeta => ({
  functions: [],
  hooks: [],
  props: [],
  variables: [],
});

/** JSX props passed to the component + function param names from body analysis */
const mergeLocalsForDisplay = (
  graph: PageLogicGraph,
  nodeId: string,
  node: LogicGraphNode
): UiLocalsMeta => {
  const fromBody = node.locals ?? emptyLocals();
  const propsByName = new Map<string, UiLocalItem>();

  for (const prop of node.props ?? []) {
    propsByName.set(prop.name, {
      expression: prop.expression,
      name: prop.name,
    });
  }

  for (const item of fromBody.props) {
    if (!propsByName.has(item.name)) {
      const callSite = resolvePropDataExpression(graph, nodeId, item.name);
      propsByName.set(item.name, {
        ...item,
        expression: item.expression ?? callSite,
      });
    }
  }

  return {
    ...fromBody,
    props: [...propsByName.values()],
  };
};

export interface UiTreeNode {
  nodeId: string;
  node: LogicGraphNode;
  renders: UiRenderItem[];
  /** Props, variables, function vars, hooks declared in the component body */
  locals: UiLocalsMeta;
  dataUsed: UiDataItem[];
  /** Conditions that must pass for this node to appear */
  gateConditions: UiGateCondition[];
  /** Conditions owned by this node (renders a condition branch) */
  localConditions: UiGateCondition[];
  children: UiTreeNode[];
}

export interface DataTraceStep {
  nodeId: string;
  label: string;
  type: string;
  kind?: DataSourceKind;
  via?: string;
  expression?: string;
  isUiNode: boolean;
  stepRole?: DataTraceStepRole;
  detail?: string;
  /** await / sync / async badge for function and fetch steps */
  executionKind?: "await" | "sync" | "async";
  /** Nested calls executed inside a parent function step */
  children?: DataTraceStep[];
  /** Source location to jump to when the step is selected */
  loc?: SourceLocation;
  /** Fallback text search when loc is unavailable */
  searchText?: string;
  /** File to search in when using searchText without loc */
  sourceFilePath?: string;
  /** Open hook trace sidebar when user clicks Trace on a hook step */
  hookTrace?: DataTraceHookTraceAction;
  /** Built-in React hook — no definition source to open */
  skipSourceLink?: boolean;
  skipSourceReason?: string;
  /** Jump to custom hook definition (not call site) */
  definitionFilePath?: string;
  definitionSymbol?: string;
  callSiteLoc?: SourceLocation;
}

export type DataTraceHookTraceAction =
  | {
      consumerNodeId: string;
      effectHookName: string;
      mode: "effect";
    }
  | {
      consumerNodeId: string;
      fieldName?: string;
      mode: "local";
      sourceHook: string;
    }
  | {
      hookNodeId: string;
      mode: "hook";
    };

export interface DataTraceBuildOptions {
  /** JSX prop name when tracing a prop chip, e.g. data */
  propName?: string;
}

export interface DataTraceChain {
  expression: string;
  consumerNodeId: string;
  /** UI node where the trace was opened (shown in dialog header, not as a step) */
  consumerLabel?: string;
  steps: DataTraceStep[];
  originNodeId?: string;
  highlightedUiNodeIds: string[];
}

export const isUiGraphNode = (node: LogicGraphNode): boolean =>
  UI_NODE_TYPES.has(node.type);

const nodesById = (graph: PageLogicGraph): Map<string, LogicGraphNode> =>
  new Map(graph.nodes.map((node) => [node.id, node]));

const outgoingEdges = (graph: PageLogicGraph, nodeId: string) =>
  graph.edges.filter((edge) => edge.source === nodeId);

const dataKindForNode = (node: LogicGraphNode): DataSourceKind => {
  const meta = node.metadata?.dataSourceKind;
  if (
    meta === "api" ||
    meta === "props" ||
    meta === "hook" ||
    meta === "function" ||
    meta === "context" ||
    meta === "store"
  ) {
    return meta;
  }
  if (node.type === "context") {
    return "context";
  }
  if (node.type === "store") {
    return "store";
  }
  if (node.type === "hook") {
    return "hook";
  }
  if (node.type === "data-fetch") {
    return node.dataFetch?.sourceKind === "function" ? "function" : "api";
  }
  return "props";
};

const dataItemName = (
  source: LogicGraphNode,
  fallbackExpression: string
): string => {
  if (source.type === "data-fetch") {
    const output = source.dataFetch?.outputNames?.[0];
    if (output) {
      return output;
    }
  }
  if (source.type === "hook" && source.hook?.outputs[0]?.name) {
    return source.hook.outputs[0]!.name;
  }
  if (source.type === "context" && source.context?.outputNames?.[0]) {
    return source.context.outputNames[0]!;
  }
  if (source.type === "store" && source.store?.outputNames?.[0]) {
    return source.store.outputNames[0]!;
  }
  return fallbackExpression.split(".")[0]?.trim() ?? fallbackExpression;
};

const traceExpressionForItem = (source: LogicGraphNode, name: string): string =>
  name;

const collectDataUsed = (
  graph: PageLogicGraph,
  nodeId: string
): UiDataItem[] => {
  const byId = nodesById(graph);
  const items: UiDataItem[] = [];
  const seen = new Set<string>();

  const push = (item: UiDataItem) => {
    const key = item.name;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    items.push(item);
  };

  for (const edge of outgoingEdges(graph, nodeId)) {
    if (edge.type !== "calls" && edge.type !== "uses-hook") {
      continue;
    }
    const source = byId.get(edge.target);
    if (!source) {
      continue;
    }
    const name = dataItemName(source, source.label);
    push({
      expression: traceExpressionForItem(source, name),
      id: `${nodeId}:data:${source.id}`,
      kind: dataKindForNode(source),
      label: source.label,
      name,
      nodeId: source.id,
    });
  }

  const context = buildNodeContext(graph, nodeId);
  if (context) {
    for (const prop of context.propsIn) {
      push({
        expression: prop.expression,
        id: `${nodeId}:prop:${prop.name}`,
        kind: prop.sourceKind ?? "props",
        label: `${prop.name} ← ${prop.expression}`,
        name: prop.name,
        nodeId: prop.sourceNodeId,
      });
    }
    for (const source of context.dataSources) {
      const name = source.label.split(" ← ")[0]?.trim() ?? source.label;
      push({
        expression: source.detail ?? source.label,
        id: `${nodeId}:inbound:${source.kind}:${source.label}`,
        kind: source.kind,
        label: source.label,
        name,
        nodeId: source.nodeId,
      });
    }
  }

  return items;
};

const buildUiSubtree = (
  graph: PageLogicGraph,
  nodeId: string,
  visited: Set<string>,
  incomingGate?: UiGateCondition,
  mode: UiHtmlVisibilityMode = "semantic"
): UiTreeNode | null => {
  const byId = nodesById(graph);
  const node = byId.get(nodeId);
  if (!node || !isUiGraphNode(node)) {
    return null;
  }
  if (visited.has(nodeId)) {
    return null;
  }
  visited.add(nodeId);

  const gateConditions: UiGateCondition[] = incomingGate ? [incomingGate] : [];

  const localConditions: UiGateCondition[] = [];
  const pushLocalCondition = (entry: UiGateCondition) => {
    if (
      localConditions.some(
        (item) => item.conditionNodeId === entry.conditionNodeId
      )
    ) {
      return;
    }
    localConditions.push(entry);
  };
  const children: UiTreeNode[] = [];
  const renders: UiRenderItem[] = [];

  for (const edge of outgoingEdges(graph, nodeId)) {
    if (!UI_CHILD_EDGE_TYPES.has(edge.type)) {
      continue;
    }
    const child = byId.get(edge.target);
    if (!child) {
      continue;
    }

    if (child.type === "condition") {
      pushLocalCondition({
        branch: "true",
        conditionNodeId: child.id,
        expression: child.condition?.expression ?? child.label,
        inputs: child.condition?.inputs ?? [],
      });
      for (const branchEdge of outgoingEdges(graph, child.id)) {
        if (
          branchEdge.type !== "condition-true" &&
          branchEdge.type !== "condition-false"
        ) {
          continue;
        }
        const branch: "true" | "false" =
          branchEdge.type === "condition-false" ? "false" : "true";
        const branchTarget = byId.get(branchEdge.target);
        if (!branchTarget) {
          continue;
        }
        if (branchTarget.type === "loop") {
          for (const loopEdge of outgoingEdges(graph, branchTarget.id)) {
            if (loopEdge.type !== "loop-renders") {
              continue;
            }
            const loopChild = buildUiSubtree(graph, loopEdge.target, visited);
            if (loopChild) {
              children.push(loopChild);
            }
          }
          continue;
        }
        const uiChild = buildUiSubtree(graph, branchEdge.target, visited);
        if (uiChild) {
          children.push(uiChild);
        }
      }
      continue;
    }

    if (child.type === "slot") {
      for (const slotEdge of outgoingEdges(graph, child.id)) {
        if (!UI_CHILD_EDGE_TYPES.has(slotEdge.type)) {
          continue;
        }
        const slotTarget = byId.get(slotEdge.target);
        if (!slotTarget) {
          continue;
        }
        if (slotTarget.type === "condition") {
          localConditions.push({
            branch: "true",
            conditionNodeId: slotTarget.id,
            expression: slotTarget.condition?.expression ?? slotTarget.label,
            inputs: slotTarget.condition?.inputs ?? [],
          });
          for (const branchEdge of outgoingEdges(graph, slotTarget.id)) {
            if (
              branchEdge.type !== "condition-true" &&
              branchEdge.type !== "condition-false"
            ) {
              continue;
            }
            const branch: "true" | "false" =
              branchEdge.type === "condition-false" ? "false" : "true";
            const branchGate: UiGateCondition = {
              branch,
              conditionNodeId: slotTarget.id,
              expression: slotTarget.condition?.expression ?? slotTarget.label,
              inputs: slotTarget.condition?.inputs ?? [],
            };
            const uiChild = buildUiSubtree(
              graph,
              branchEdge.target,
              visited,
              branchGate
            );
            if (uiChild) {
              children.push(uiChild);
            }
          }
          continue;
        }
        if (slotTarget.type === "loop") {
          for (const loopEdge of outgoingEdges(graph, slotTarget.id)) {
            if (loopEdge.type !== "loop-renders") {
              continue;
            }
            const loopChild = buildUiSubtree(
              graph,
              loopEdge.target,
              visited,
              incomingGate
            );
            if (loopChild) {
              children.push(loopChild);
            }
          }
          continue;
        }
        if (isUiGraphNode(slotTarget)) {
          const uiChild = buildUiSubtree(
            graph,
            slotEdge.target,
            visited,
            incomingGate
          );
          if (uiChild) {
            children.push(uiChild);
          }
        }
      }
      continue;
    }

    if (child.type === "loop") {
      for (const loopEdge of outgoingEdges(graph, child.id)) {
        if (loopEdge.type !== "loop-renders") {
          continue;
        }
        const loopChild = buildUiSubtree(graph, loopEdge.target, visited);
        if (loopChild) {
          children.push(loopChild);
        }
      }
      continue;
    }

    if (isUiGraphNode(child)) {
      if (shouldFlattenHtmlNode(child, graph, mode, byId)) {
        const flattened = flattenHtmlSubtree({
          graph,
          htmlNode: child,
          incomingGate,
          mode,
          visited,
        });
        children.push(...flattened.children);
        renders.push(...flattened.renders);
        continue;
      }

      renders.push({
        edgeLabel: edge.label,
        edgeType: edge.type,
        label: child.label,
        nodeId: child.id,
        props: child.props ?? [],
        type: child.type,
      });
      const uiChild = buildUiSubtree(
        graph,
        child.id,
        visited,
        incomingGate,
        mode
      );
      if (uiChild) {
        children.push(uiChild);
      }
      continue;
    }

    if (child.type === "ui-content") {
      renders.push({
        edgeLabel: edge.label,
        edgeType: edge.type,
        label: child.uiContent?.preview ?? child.label,
        nodeId: child.id,
        props: [],
        type: child.type,
      });
    }
  }

  return {
    children,
    dataUsed: collectDataUsed(graph, nodeId),
    gateConditions,
    localConditions,
    locals: mergeLocalsForDisplay(graph, nodeId, node),
    node,
    nodeId,
    renders,
  };
};

export const buildUiTree = (
  graph: PageLogicGraph,
  options?: BuildUiTreeOptions
): UiTreeNode | null =>
  buildUiSubtree(
    graph,
    graph.rootNodeId,
    new Set(),
    undefined,
    options?.htmlVisibility ?? "semantic"
  );

/** All descendant node ids in the UI tree (direct + nested children). */
export const collectUiDescendantIds = (tree: UiTreeNode): string[] => {
  const ids: string[] = [];
  const walk = (node: UiTreeNode) => {
    for (const child of node.children) {
      ids.push(child.nodeId);
      walk(child);
    }
  };
  walk(tree);
  return ids;
};

const buildHighlightedUiNodeIds = (
  uiTree: UiTreeNode | null,
  consumerNodeId: string,
  stepNodeIds: string[]
): string[] => {
  const ids = new Set<string>([consumerNodeId]);
  if (!uiTree) {
    return [...ids];
  }

  const uiIds = collectUiNodeIds(uiTree);
  for (const stepId of stepNodeIds) {
    if (uiIds.has(stepId)) {
      ids.add(stepId);
    }
  }

  const path = findUiTreeNodePath(uiTree, consumerNodeId);
  if (path) {
    for (const node of path) {
      ids.add(node.nodeId);
    }
  }

  return [...ids];
};

export const findUiTreeNode = (
  tree: UiTreeNode,
  nodeId: string
): UiTreeNode | null => {
  if (tree.nodeId === nodeId) {
    return tree;
  }
  for (const child of tree.children) {
    const found = findUiTreeNode(child, nodeId);
    if (found) {
      return found;
    }
  }
  return null;
};

/** Ancestor path from UI tree root to the target node (inclusive). */
export const findUiTreeNodePath = (
  tree: UiTreeNode,
  nodeId: string,
  path: UiTreeNode[] = []
): UiTreeNode[] | null => {
  const nextPath = [...path, tree];
  if (tree.nodeId === nodeId) {
    return nextPath;
  }
  for (const child of tree.children) {
    const found = findUiTreeNodePath(child, nodeId, nextPath);
    if (found) {
      return found;
    }
  }
  return null;
};

const collectUiNodeIds = (tree: UiTreeNode | null): Set<string> => {
  const ids = new Set<string>();
  if (!tree) {
    return ids;
  }
  const walk = (node: UiTreeNode) => {
    ids.add(node.nodeId);
    for (const child of node.children) {
      walk(child);
    }
  };
  walk(tree);
  return ids;
};

const rootIdentifier = (expression: string): string =>
  expression.split(".")[0]?.trim() ?? expression;

const memberPath = (expression: string): string | undefined => {
  const root = rootIdentifier(expression);
  if (expression === root) {
    return undefined;
  }
  return expression.slice(root.length + 1);
};

const resolveTraceOriginStep = (
  steps: DataTraceStep[]
): DataTraceStep | undefined =>
  steps.find((step) => step.stepRole === "literal") ??
  steps.find((step) => step.stepRole === "hardcode") ??
  steps.find((step) => step.type === "binding") ??
  steps.find((step) => step.stepRole === "api-call") ??
  steps.find((step) => step.stepRole === "function") ??
  steps.find((step) => step.stepRole === "await-call") ??
  steps.at(-1) ??
  steps.find((step) => !step.isUiNode) ??
  steps[0];

const appendTraceStep = (steps: DataTraceStep[], step: DataTraceStep): void => {
  if (
    steps.some(
      (item) => item.nodeId === step.nodeId && item.label === step.label
    )
  ) {
    return;
  }
  steps.push(step);
};

const executionKindForNested = (nested: {
  awaited?: boolean;
  isAsync?: boolean;
}): "await" | "sync" | "async" => {
  if (nested.awaited) {
    return "await";
  }
  if (nested.isAsync) {
    return "async";
  }
  return "sync";
};

const VALUE_KIND_LABELS: Record<string, string> = {
  array: "array",
  call: "call",
  identifier: "identifier",
  literal: "literal",
  object: "object",
};

const LOOP_PARENT_EDGE_TYPES = new Set([
  "renders",
  "loop-renders",
  "condition-true",
  "condition-false",
]);

const findEnclosingLoopForItem = (
  graph: PageLogicGraph,
  consumerNodeId: string,
  itemName: string
): LogicGraphNode | undefined => {
  const byId = nodesById(graph);
  const parentsByTarget = new Map<string, LogicGraphEdge[]>();
  for (const edge of graph.edges) {
    if (!LOOP_PARENT_EDGE_TYPES.has(edge.type)) {
      continue;
    }
    const list = parentsByTarget.get(edge.target) ?? [];
    list.push(edge);
    parentsByTarget.set(edge.target, list);
  }

  const visited = new Set<string>();
  const queue = [consumerNodeId];

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (visited.has(nodeId)) {
      continue;
    }
    visited.add(nodeId);

    for (const edge of parentsByTarget.get(nodeId) ?? []) {
      const parent = byId.get(edge.source);
      if (!parent) {
        continue;
      }
      if (parent.type === "loop" && parent.loop?.itemName === itemName) {
        return parent;
      }
      queue.push(edge.source);
    }
  }

  return undefined;
};

const appendLoopItemMemberTraceSteps = ({
  consumerNodeId,
  fieldPath,
  graph,
  itemName,
  loopNode,
  propName,
  steps,
  traceExpression,
}: {
  consumerNodeId: string;
  fieldPath: string | undefined;
  graph: PageLogicGraph;
  itemName: string;
  loopNode: LogicGraphNode;
  propName?: string;
  steps: DataTraceStep[];
  traceExpression: string;
}): void => {
  const sourceExpression = loopNode.loop?.sourceExpression;
  if (!sourceExpression) {
    return;
  }

  if (fieldPath) {
    const memberLoc = propName
      ? propUsageLoc(graph, consumerNodeId, propName)
      : undefined;
    appendTraceStep(steps, {
      detail: fieldPath,
      expression: traceExpression,
      isUiNode: false,
      kind: "props",
      label: traceExpression,
      loc: memberLoc,
      nodeId: `${consumerNodeId}:loop-member:${traceExpression}`,
      searchText: memberLoc ? undefined : traceExpression,
      stepRole: "variable",
      type: "member",
    });
  }

  appendTraceStep(steps, {
    detail: `${sourceExpression}.map(${itemName})`,
    expression: itemName,
    isUiNode: false,
    kind: "props",
    label: itemName,
    loc: loopNode.loc,
    nodeId: `${loopNode.id}:item:${itemName}`,
    searchText: loopNode.loc ? `.map((${itemName})` : `${itemName})`,
    stepRole: "variable",
    type: "loop-item",
  });

  const binding = findModuleBinding(graph, sourceExpression, consumerNodeId);
  if (binding) {
    appendBindingTraceSteps({
      binding,
      bindingName: sourceExpression,
      consumerNodeId,
      steps,
    });
    return;
  }

  appendTraceStep(steps, {
    expression: sourceExpression,
    isUiNode: false,
    kind: "props",
    label: sourceExpression,
    loc: loopNode.loc,
    nodeId: `${consumerNodeId}:loop-source:${sourceExpression}`,
    searchText: loopNode.loc ? undefined : `const ${sourceExpression}`,
    stepRole: "variable",
    type: "binding",
  });
};

const findModuleBinding = (
  graph: PageLogicGraph,
  bindingName: string,
  consumerNodeId: string
): ModuleBindingMeta | undefined => {
  const consumer = nodesById(graph).get(consumerNodeId);
  const consumerFile = consumer?.loc?.filePath ?? consumer?.filePath;

  const searchBindings = (
    matchFile?: string
  ): ModuleBindingMeta | undefined => {
    for (const node of graph.nodes) {
      const bindings = node.metadata?.moduleBindings as
        | ModuleBindingMeta[]
        | undefined;
      if (!bindings?.length) {
        continue;
      }
      const nodeFile = node.loc?.filePath ?? node.filePath;
      if (matchFile && nodeFile && nodeFile !== matchFile) {
        continue;
      }
      const match = bindings.find((item) => item.name === bindingName);
      if (match) {
        return match;
      }
    }
    return undefined;
  };

  return searchBindings(consumerFile) ?? searchBindings();
};

const propUsageLoc = (
  graph: PageLogicGraph,
  consumerNodeId: string,
  propName: string
): SourceLocation | undefined =>
  resolveImmediatePropLoc(graph, consumerNodeId, propName) ??
  resolveImmediatePropLoc(
    graph,
    resolveConsumerAnchorId(graph, consumerNodeId),
    propName
  );

const appendPropPassThroughTraceSteps = ({
  consumerNodeId,
  graph,
  propName,
  steps,
}: {
  consumerNodeId: string;
  graph: PageLogicGraph;
  propName: string;
  steps: DataTraceStep[];
}): void => {
  for (const propStep of collectPropPassThroughSteps(
    graph,
    consumerNodeId,
    propName
  )) {
    appendTraceStep(steps, {
      detail:
        propStep.expression !== propName ? propStep.expression : undefined,
      expression: propStep.expression,
      isUiNode: false,
      kind: "props",
      label: propName,
      loc: propStep.loc,
      nodeId: `${propStep.componentId}:prop:${propName}`,
      searchText: propStep.loc ? undefined : `${propName}=`,
      stepRole: "prop",
      type: "prop",
    });
  }
};

const traceLocForCallTreeNode = (
  node: DataFetchCallTreeNode
): SourceLocation | undefined => node.definitionLoc ?? node.callSiteLoc;

const callTreeToTraceSteps = (
  nodes: DataFetchCallTreeNode[],
  parentId: string
): DataTraceStep[] =>
  nodes.map((node, index) => ({
    children:
      node.children.length > 0
        ? callTreeToTraceSteps(node.children, `${parentId}:${index}`)
        : undefined,
    detail: node.returnType ? `→ ${node.returnType}` : undefined,
    executionKind:
      node.kind === "function"
        ? executionKindForNested(node)
        : (node.kind === "promise-all"
          ? "async"
          : undefined),
    expression: node.functionName ?? node.label,
    isUiNode: false,
    kind: node.kind === "api" ? "api" : "function",
    label: node.label,
    loc: traceLocForCallTreeNode(node),
    nodeId: `${parentId}:tree:${node.kind}:${node.functionName ?? index}`,
    searchText:
      node.kind === "api" && !node.callSiteLoc ? node.label : undefined,
    stepRole:
      node.kind === "api"
        ? "api-call"
        : (node.kind === "promise-all"
          ? "function"
          : "function"),
    type: node.kind,
  }));

const appendBindingTraceSteps = ({
  binding,
  bindingName,
  consumerNodeId,
  steps,
}: {
  binding: ModuleBindingMeta;
  bindingName: string;
  consumerNodeId: string;
  steps: DataTraceStep[];
}): void => {
  const valueDetail =
    binding.valueKind && binding.valueKind !== "call"
      ? VALUE_KIND_LABELS[binding.valueKind]
      : undefined;

  appendTraceStep(steps, {
    detail: valueDetail,
    expression: bindingName,
    isUiNode: false,
    kind: "props",
    label: bindingName,
    loc: binding.loc,
    nodeId: `${consumerNodeId}:binding:${bindingName}`,
    searchText: binding.loc ? undefined : `const ${bindingName}`,
    stepRole: "variable",
    type: "binding",
  });

  if (binding.callFunctionName) {
    appendTraceStep(steps, {
      detail: binding.returnType ? `→ ${binding.returnType}` : undefined,
      executionKind: "sync",
      expression: binding.callExpression ?? binding.callFunctionName,
      isUiNode: false,
      kind: "function",
      label: `${binding.callFunctionName}()`,
      loc: binding.callDefinitionLoc ?? binding.loc,
      nodeId: `${consumerNodeId}:binding-call:${binding.callFunctionName}`,
      searchText:
        binding.callDefinitionLoc || binding.loc
          ? undefined
          : `${binding.callFunctionName}(`,
      stepRole: "function",
      type: "function",
    });
  }
};

const appendDataFetchTraceSteps = ({
  consumerNodeId,
  fetch,
  fieldPath,
  graph,
  propName,
  sourceNode,
  steps,
  variableName,
}: {
  consumerNodeId: string;
  fetch: NonNullable<LogicGraphNode["dataFetch"]>;
  fieldPath: string | undefined;
  graph: PageLogicGraph;
  propName?: string;
  sourceNode: LogicGraphNode;
  steps: DataTraceStep[];
  variableName: string;
}): void => {
  if (propName) {
    appendPropPassThroughTraceSteps({
      consumerNodeId,
      graph,
      propName,
      steps,
    });
  }

  const extendedFetch = fetch as NonNullable<LogicGraphNode["dataFetch"]> & {
    assignmentLoc?: SourceLocation;
    definitionLoc?: SourceLocation;
    nestedCallTree?: DataFetchCallTreeNode[];
    outputNames?: string[];
    resolvedFilePath?: string;
    returnFieldLiterals?: Record<string, string>;
    returnType?: string;
  };

  appendTraceStep(steps, {
    expression: variableName,
    isUiNode: false,
    kind: dataKindForNode(sourceNode),
    label: variableName,
    loc: extendedFetch.assignmentLoc ?? sourceNode.loc,
    nodeId: `${sourceNode.id}:var`,
    searchText:
      (extendedFetch.assignmentLoc ?? sourceNode.loc)
        ? undefined
        : `${variableName} =`,
    stepRole: "variable",
    type: "variable",
  });

  const nestedChildren = callTreeToTraceSteps(
    extendedFetch.nestedCallTree ?? [],
    sourceNode.id
  );

  appendTraceStep(steps, {
    children: nestedChildren.length > 0 ? nestedChildren : undefined,
    detail: extendedFetch.returnType
      ? `→ ${extendedFetch.returnType}`
      : fetch.callExpression,
    executionKind: fetch.awaited ? "await" : "sync",
    expression: fetch.callExpression,
    isUiNode: false,
    kind: dataKindForNode(sourceNode),
    label: `${fetch.functionName}()`,
    loc:
      extendedFetch.definitionLoc ??
      (extendedFetch.resolvedFilePath &&
      sourceNode.loc?.filePath !== extendedFetch.resolvedFilePath
        ? undefined
        : sourceNode.loc),
    nodeId: sourceNode.id,
    searchText:
      extendedFetch.definitionLoc ||
      sourceNode.loc ||
      extendedFetch.resolvedFilePath
        ? undefined
        : `${fetch.functionName}(`,
    stepRole: "await-call",
    type: sourceNode.type,
  });

  if (extendedFetch.resolvedFilePath && fetch.functionName) {
    const awaitStep = steps.at(-1);
    if (awaitStep && !awaitStep.loc) {
      awaitStep.loc = {
        endColumn: 1,
        endLine: 1,
        filePath: extendedFetch.resolvedFilePath,
        startColumn: 1,
        startLine: 1,
      };
      awaitStep.searchText = `function ${fetch.functionName}`;
    }
  }

  if (
    fieldPath &&
    extendedFetch.returnFieldLiterals?.[fieldPath] !== undefined
  ) {
    const literal = extendedFetch.returnFieldLiterals[fieldPath];
    appendTraceStep(steps, {
      detail: fieldPath,
      expression: `${variableName}.${fieldPath}`,
      isUiNode: false,
      kind: "api",
      label: `Hard code: ${literal}`,
      loc: extendedFetch.resolvedFilePath
        ? {
            endColumn: 1,
            endLine: 1,
            filePath: extendedFetch.resolvedFilePath,
            startColumn: 1,
            startLine: 1,
          }
        : undefined,
      nodeId: `${sourceNode.id}:hardcode:${fieldPath}`,
      searchText: `${fieldPath}: ${literal}`,
      stepRole: "hardcode",
      type: "hardcode",
    });
  }
};

const pickRelevantNestedHooks = (
  fieldName: string | undefined,
  nestedHooks: string[]
): string[] => {
  if (!fieldName || nestedHooks.length <= 1) {
    return nestedHooks;
  }
  const field = fieldName.toLowerCase();
  const matched = nestedHooks.filter((name) => {
    const stem = name.replace(/^use/i, "").toLowerCase();
    return (
      field.includes(stem.slice(0, Math.min(5, stem.length))) ||
      stem.includes(field.slice(0, Math.min(5, field.length)))
    );
  });
  return matched.length > 0 ? matched : nestedHooks;
};

const collectNestedHookChain = (
  graph: PageLogicGraph,
  hookNode: LogicGraphNode,
  fieldName?: string
): LogicGraphNode[] => {
  const nestedNames = pickRelevantNestedHooks(
    fieldName,
    hookNode.hook?.nestedHooks ?? []
  );
  const chain: LogicGraphNode[] = [];

  for (const nestedName of nestedNames) {
    const nestedNode =
      graph.nodes.find(
        (node) =>
          node.type === "hook" &&
          node.label === nestedName &&
          graph.edges.some(
            (edge) =>
              edge.source === hookNode.id &&
              edge.target === node.id &&
              edge.type === "uses-hook"
          )
      ) ??
      graph.nodes.find(
        (node) => node.type === "hook" && node.label === nestedName
      );

    if (!nestedNode || chain.some((item) => item.id === nestedNode.id)) {
      continue;
    }

    chain.push(nestedNode);
    chain.push(...collectNestedHookChain(graph, nestedNode, fieldName));
  }

  return chain;
};

const escapeRegExp = (value: string): string =>
  value.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");

const findConsumerVariable = (
  graph: PageLogicGraph,
  consumerNodeId: string,
  name: string
): { item: UiLocalItem; locals: UiLocalsMeta } | undefined => {
  const consumer = nodesById(graph).get(consumerNodeId);
  if (!consumer) {
    return undefined;
  }
  const locals = mergeLocalsForDisplay(graph, consumerNodeId, consumer);
  const item = locals.variables.find((entry) => entry.name === name);
  if (!item) {
    return undefined;
  }
  return { item, locals };
};

/** Derived locals (e.g. `hasPlans = plans.length > 0`) — not await/data-fetch outputs. */
const isDerivedLocalVariable = (item: UiLocalItem): boolean =>
  !item.nodeId && !item.expression?.includes("await");

const referencedLocalNames = (
  expression: string | undefined,
  locals: UiLocalsMeta,
  selfName: string
): string[] => {
  if (!expression) {
    return [];
  }
  const candidates = [
    ...locals.props.map((entry) => entry.name),
    ...locals.variables
      .map((entry) => entry.name)
      .filter((entryName) => entryName !== selfName),
    ...locals.hooks.map((entry) => entry.name),
  ];
  return candidates.filter((name) =>
    new RegExp(`\\b${escapeRegExp(name)}\\b`).test(expression)
  );
};

const traceResolveOptions = {
  skipConditionInputMatch: true,
  skipHookInputMatch: true,
} as const;

const appendUpstreamLocalTrace = ({
  consumerNodeId,
  graph,
  locals,
  steps,
  upstreamName,
}: {
  consumerNodeId: string;
  graph: PageLogicGraph;
  locals: UiLocalsMeta;
  steps: DataTraceStep[];
  upstreamName: string;
}): void => {
  const isProp = locals.props.some((entry) => entry.name === upstreamName);
  const callSite = resolveCallSitePropExpression(
    graph,
    consumerNodeId,
    upstreamName
  );
  const traceExpr = callSite ?? upstreamName;
  const sourceNode = resolveExpressionToNode(
    graph,
    traceExpr,
    consumerNodeId,
    traceResolveOptions
  );

  if (sourceNode?.type === "data-fetch" && sourceNode.dataFetch) {
    const fetch = sourceNode.dataFetch;
    const variableName = fetch.outputNames?.[0] ?? rootIdentifier(traceExpr);
    appendDataFetchTraceSteps({
      consumerNodeId,
      fetch,
      fieldPath: memberPath(traceExpr),
      graph,
      propName: isProp ? upstreamName : undefined,
      sourceNode,
      steps,
      variableName,
    });
  }
};

const appendLocalVariableTrace = ({
  consumerNodeId,
  graph,
  item,
  locals,
  steps,
}: {
  consumerNodeId: string;
  graph: PageLogicGraph;
  item: UiLocalItem;
  locals: UiLocalsMeta;
  steps: DataTraceStep[];
}): void => {
  appendTraceStep(steps, {
    expression: item.expression ?? item.name,
    isUiNode: false,
    kind: "props",
    label: item.name,
    loc: item.loc,
    nodeId: `${consumerNodeId}:local:${item.name}`,
    searchText: item.loc
      ? undefined
      : (item.expression ?? `const ${item.name}`),
    stepRole: "variable",
    type: "local",
  });

  const upstreamNames = referencedLocalNames(
    item.expression,
    locals,
    item.name
  );
  const propsFirst = [
    ...upstreamNames.filter((name) =>
      locals.props.some((entry) => entry.name === name)
    ),
    ...upstreamNames.filter(
      (name) => !locals.props.some((entry) => entry.name === name)
    ),
  ];

  for (const upstreamName of propsFirst) {
    appendUpstreamLocalTrace({
      consumerNodeId,
      graph,
      locals,
      steps,
      upstreamName,
    });
    if (steps.length > 1) {
      break;
    }
  }
};

const resolveHookNodeForLocal = (
  graph: PageLogicGraph,
  item: UiLocalItem,
  sourceHook: string
): LogicGraphNode | undefined => {
  if (item.nodeId) {
    const linked = nodesById(graph).get(item.nodeId);
    if (linked?.type === "hook") {
      return linked;
    }
  }
  return graph.nodes.find(
    (node) => node.type === "hook" && node.label === sourceHook
  );
};

const appendHookAssignedLocalTrace = ({
  consumerNodeId,
  graph,
  item,
  steps,
}: {
  consumerNodeId: string;
  graph: PageLogicGraph;
  item: UiLocalItem;
  steps: DataTraceStep[];
}): void => {
  const { sourceHook } = item;
  if (!sourceHook) {
    return;
  }

  appendTraceStep(steps, {
    expression: item.expression ?? item.name,
    isUiNode: false,
    kind: "hook",
    label: item.name,
    loc: item.loc,
    nodeId: `${consumerNodeId}:local:${item.name}`,
    searchText: item.loc
      ? undefined
      : (item.expression ?? `const ${item.name}`),
    stepRole: "variable",
    type: "local",
  });

  const hookNode = resolveHookNodeForLocal(graph, item, sourceHook);
  if (!hookNode) {
    return;
  }

  appendTraceStep(steps, {
    expression: sourceHook,
    hookTrace: {
      consumerNodeId,
      fieldName: item.name,
      mode: "local",
      sourceHook,
    },
    isUiNode: false,
    kind: "hook",
    label: sourceHook,
    loc: hookNode.loc,
    nodeId: hookNode.id,
    searchText: hookNode.loc ? undefined : sourceHook,
    skipSourceLink: isReactBuiltInHook(sourceHook),
    skipSourceReason: isReactBuiltInHook(sourceHook)
      ? "Built-in React hook"
      : undefined,
    stepRole: "hook",
    type: hookNode.type,
  });

  for (const nested of collectNestedHookChain(graph, hookNode, item.name)) {
    appendTraceStep(steps, {
      expression: nested.label,
      hookTrace: {
        hookNodeId: nested.id,
        mode: "hook",
      },
      isUiNode: false,
      kind: "hook",
      label: nested.label,
      loc: nested.loc,
      nodeId: nested.id,
      searchText: nested.loc ? undefined : nested.label,
      stepRole: "hook",
      type: nested.type,
    });
  }
};

export const buildDataTraceChain = (
  graph: PageLogicGraph,
  expression: string,
  consumerNodeId: string,
  uiTree?: UiTreeNode | null,
  options?: DataTraceBuildOptions
): DataTraceChain => {
  const byId = nodesById(graph);
  const consumer = byId.get(consumerNodeId);
  const propName = options?.propName;

  if (!propName && expression === rootIdentifier(expression)) {
    const localVariable = findConsumerVariable(
      graph,
      consumerNodeId,
      expression
    );
    if (localVariable?.item.sourceHook) {
      const steps: DataTraceStep[] = [];
      appendHookAssignedLocalTrace({
        consumerNodeId,
        graph,
        item: localVariable.item,
        steps,
      });

      const resolvedUiTree = uiTree ?? buildUiTree(graph);

      return {
        consumerLabel: consumer?.label,
        consumerNodeId,
        expression,
        highlightedUiNodeIds: buildHighlightedUiNodeIds(
          resolvedUiTree,
          consumerNodeId,
          steps.map((step) => step.nodeId)
        ),
        originNodeId: steps.at(-1)?.nodeId,
        steps,
      };
    }
    if (localVariable && isDerivedLocalVariable(localVariable.item)) {
      const steps: DataTraceStep[] = [];
      appendLocalVariableTrace({
        consumerNodeId,
        graph,
        item: localVariable.item,
        locals: localVariable.locals,
        steps,
      });

      const resolvedUiTree = uiTree ?? buildUiTree(graph);
      const origin = resolveTraceOriginStep(steps);

      return {
        consumerLabel: consumer?.label,
        consumerNodeId,
        expression,
        highlightedUiNodeIds: buildHighlightedUiNodeIds(
          resolvedUiTree,
          consumerNodeId,
          steps.map((step) => step.nodeId)
        ),
        originNodeId: origin?.nodeId,
        steps,
      };
    }
  }

  const dataPropExpression =
    propName !== undefined
      ? resolvePropDataExpression(graph, consumerNodeId, propName)
      : undefined;

  let traceExpression = expression;
  if (
    dataPropExpression &&
    (expression === propName ||
      expression === dataPropExpression ||
      !expression.includes("."))
  ) {
    traceExpression = dataPropExpression;
  }

  const root = rootIdentifier(traceExpression);
  const fieldPath = memberPath(traceExpression);
  const resolveOptions = propName
    ? { skipHookInputMatch: true as const }
    : undefined;
  let sourceNode =
    resolveExpressionToNode(
      graph,
      traceExpression,
      consumerNodeId,
      resolveOptions
    ) ?? resolveExpressionToNode(graph, root, consumerNodeId, resolveOptions);

  if (
    propName &&
    sourceNode?.type === "hook" &&
    dataPropExpression &&
    dataPropExpression !== traceExpression
  ) {
    const upstream = resolveExpressionToNode(
      graph,
      dataPropExpression,
      consumerNodeId,
      resolveOptions
    );
    if (upstream?.type === "data-fetch") {
      sourceNode = upstream;
      traceExpression = dataPropExpression;
    }
  }

  const steps: DataTraceStep[] = [];
  const effectiveFieldPath = memberPath(traceExpression) ?? fieldPath;

  if (sourceNode?.type === "data-fetch" && sourceNode.dataFetch) {
    const fetch = sourceNode.dataFetch;
    const variableName =
      fetch.outputNames?.[0] ?? rootIdentifier(traceExpression);

    appendDataFetchTraceSteps({
      consumerNodeId,
      fetch,
      fieldPath: effectiveFieldPath,
      graph,
      propName,
      sourceNode,
      steps,
      variableName,
    });
  } else if (propName || !sourceNode) {
    const binding = findModuleBinding(graph, root, consumerNodeId);

    if (propName) {
      appendPropPassThroughTraceSteps({
        consumerNodeId,
        graph,
        propName,
        steps,
      });
    }

    if (binding) {
      appendBindingTraceSteps({
        binding,
        bindingName: root,
        consumerNodeId,
        steps,
      });
    } else {
      const loopNode = findEnclosingLoopForItem(graph, consumerNodeId, root);
      if (loopNode) {
        appendLoopItemMemberTraceSteps({
          consumerNodeId,
          fieldPath: effectiveFieldPath,
          graph,
          itemName: root,
          loopNode,
          propName,
          steps,
          traceExpression,
        });
      } else if (!propName) {
        appendTraceStep(steps, {
          expression: root,
          isUiNode: false,
          kind: "props",
          label: root,
          nodeId: `${consumerNodeId}:expr:${root}`,
          stepRole: "variable",
          type: "variable",
        });
      }
    }
  } else if (sourceNode?.type === "hook") {
    const hookName = sourceNode.label;
    const isHookField =
      root !== hookName &&
      sourceNode.hook?.outputs.some((field) => field.name === root);

    if (isHookField) {
      appendTraceStep(steps, {
        expression: root,
        isUiNode: false,
        kind: "hook",
        label: root,
        loc: sourceNode.loc,
        nodeId: `${sourceNode.id}:field:${root}`,
        stepRole: "variable",
        type: "field",
      });
    }

    appendTraceStep(steps, {
      expression: hookName,
      isUiNode: false,
      kind: "hook",
      label: `(hook) ${hookName}`,
      loc: sourceNode.loc,
      nodeId: sourceNode.id,
      searchText: sourceNode.loc ? undefined : hookName,
      stepRole: "hook",
      type: sourceNode.type,
    });

    for (const nested of collectNestedHookChain(graph, sourceNode, root)) {
      appendTraceStep(steps, {
        expression: nested.label,
        isUiNode: false,
        kind: "hook",
        label: `(hook) ${nested.label}`,
        loc: nested.loc,
        nodeId: nested.id,
        searchText: nested.loc ? undefined : nested.label,
        stepRole: "hook",
        type: nested.type,
      });
    }
  } else if (sourceNode?.type === "context") {
    appendTraceStep(steps, {
      expression: sourceNode.label,
      isUiNode: false,
      kind: "context",
      label: sourceNode.label,
      loc: sourceNode.loc,
      nodeId: sourceNode.id,
      stepRole: "context",
      type: sourceNode.type,
    });
  } else if (sourceNode?.type === "store") {
    appendTraceStep(steps, {
      expression: sourceNode.label,
      isUiNode: false,
      kind: "store",
      label: sourceNode.label,
      loc: sourceNode.loc,
      nodeId: sourceNode.id,
      stepRole: "store",
      type: sourceNode.type,
    });
  }

  const resolvedUiTree = uiTree ?? buildUiTree(graph);
  const origin = resolveTraceOriginStep(steps);

  return {
    consumerLabel: consumer?.label,
    consumerNodeId,
    expression: traceExpression,
    highlightedUiNodeIds: buildHighlightedUiNodeIds(
      resolvedUiTree,
      consumerNodeId,
      steps.map((step) => step.nodeId)
    ),
    originNodeId: origin?.nodeId,
    steps,
  };
};

export const flattenUiTree = (tree: UiTreeNode | null): UiTreeNode[] => {
  if (!tree) {
    return [];
  }
  const result: UiTreeNode[] = [];
  const walk = (node: UiTreeNode) => {
    result.push(node);
    for (const child of node.children) {
      walk(child);
    }
  };
  walk(tree);
  return result;
};
