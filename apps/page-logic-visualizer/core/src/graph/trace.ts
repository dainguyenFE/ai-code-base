import type { LogicGraphEdge, LogicGraphNode, PageLogicGraph } from "../types";

export type TraceRole =
  | "focus"
  | "visibility-condition"
  | "prop-input"
  | "data-source"
  | "hook-logic"
  | "loop-logic"
  | "ui-output";

export interface TraceStep {
  nodeId: string;
  node: LogicGraphNode;
  depth: number;
  role: TraceRole;
  via?: string;
  expression?: string;
}

export interface TraceLink {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  label: string;
}

export interface VisibilityCondition {
  conditionNodeId: string;
  expression: string;
  branch: "true" | "false" | "and";
  inputs: string[];
  parentLabel: string;
}

export interface PropTrace {
  name: string;
  expression: string;
  sourceNodeId?: string;
  sourceLabel?: string;
  sourceType?: string;
  sourceKind?: DataSourceKind;
}

export interface DataSourceTrace {
  kind: DataSourceKind;
  label: string;
  nodeId?: string;
  detail?: string;
}

export interface RenderChild {
  nodeId: string;
  label: string;
  type: string;
  edgeType: string;
  edgeLabel?: string;
}

export interface NodeContextView {
  node: LogicGraphNode;
  visibilityConditions: VisibilityCondition[];
  propsIn: PropTrace[];
  dataSources: DataSourceTrace[];
  rendersOut: RenderChild[];
}

export interface FocusDiagram {
  steps: TraceStep[];
  links: TraceLink[];
  focusNodeId: string;
}

const UPSTREAM_EDGE_TYPES = new Set([
  "calls",
  "uses-hook",
  "hook-input",
  "renders",
  "condition-true",
  "condition-false",
  "loop-renders",
  "passes-props",
]);

const DOWNSTREAM_EDGE_TYPES = new Set([
  "renders",
  "condition-true",
  "condition-false",
  "loop-renders",
  "displays",
  "uses-hook",
  "hook-output",
  "calls",
]);

const dataSourceKindForNode = (
  node: LogicGraphNode
): DataSourceKind | undefined => {
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
  if (node.type === "data-fetch") {
    return node.dataFetch?.sourceKind === "function" ? "function" : "api";
  }
  if (node.type === "hook") {
    return "hook";
  }
  return undefined;
};

const roleForNode = (node: LogicGraphNode): TraceRole => {
  if (
    node.type === "data-fetch" ||
    node.type === "context" ||
    node.type === "store"
  ) {
    return "data-source";
  }
  if (node.type === "hook") {
    return "hook-logic";
  }
  if (node.type === "condition") {
    return "visibility-condition";
  }
  if (node.type === "loop") {
    return "loop-logic";
  }
  if (node.type === "ui-content") {
    return "ui-output";
  }
  return "ui-output";
};

const nodesById = (graph: PageLogicGraph): Map<string, LogicGraphNode> =>
  new Map(graph.nodes.map((node) => [node.id, node]));

const incomingEdges = (
  graph: PageLogicGraph,
  nodeId: string
): LogicGraphEdge[] => graph.edges.filter((edge) => edge.target === nodeId);

const outgoingEdges = (
  graph: PageLogicGraph,
  nodeId: string
): LogicGraphEdge[] => graph.edges.filter((edge) => edge.source === nodeId);

const rootIdentifier = (expression: string): string =>
  expression.split(".")[0]?.trim() ?? expression;

const expansionAnchorId = (
  graph: PageLogicGraph,
  nodeId: string
): string | undefined => {
  if (!nodeId.startsWith("exp:")) {
    return undefined;
  }
  const rest = nodeId.slice(4);
  let best: string | undefined;
  for (const node of graph.nodes) {
    if (rest === node.id || rest.startsWith(`${node.id}:`)) {
      if (!best || node.id.length > best.length) {
        best = node.id;
      }
    }
  }
  return best;
};

/** Route-graph component node that owns an expanded subgraph (or the node itself). */
export const resolveConsumerAnchorId = (
  graph: PageLogicGraph,
  consumerNodeId: string
): string => {
  const byId = nodesById(graph);
  let currentId = consumerNodeId;
  const visited = new Set<string>();

  while (!visited.has(currentId)) {
    visited.add(currentId);
    const node = byId.get(currentId);
    if (!node) {
      break;
    }

    const expandedFrom = node.metadata?.expandedFrom;
    if (typeof expandedFrom === "string" && byId.has(expandedFrom)) {
      currentId = expandedFrom;
      continue;
    }

    const fromPrefix = expansionAnchorId(graph, currentId);
    if (fromPrefix && fromPrefix !== currentId) {
      currentId = fromPrefix;
      continue;
    }

    break;
  }

  return currentId;
};

const propExpressionFromNode = (
  node: LogicGraphNode | undefined,
  propName: string
): string | undefined =>
  node?.props?.find((item) => item.name === propName)?.expression;

const propLocFromNode = (
  node: LogicGraphNode | undefined,
  propName: string
): SourceLocation | undefined =>
  node?.props?.find((item) => item.name === propName)?.loc;

const UI_PARENT_EDGE_TYPES = new Set([
  "renders",
  "condition-true",
  "condition-false",
  "loop-renders",
]);

const findRenderingParentComponent = (
  graph: PageLogicGraph,
  nodeId: string
): LogicGraphNode | undefined => {
  const byId = nodesById(graph);
  const visited = new Set<string>();
  let currentId: string | undefined = nodeId;

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const parentEdge = graph.edges.find(
      (edge) => edge.target === currentId && UI_PARENT_EDGE_TYPES.has(edge.type)
    );
    if (!parentEdge) {
      break;
    }

    const parent = byId.get(parentEdge.source);
    if (!parent) {
      break;
    }

    if (
      parent.type === "component" ||
      parent.type === "page" ||
      parent.type === "layout"
    ) {
      return parent;
    }

    currentId = parent.id;
  }

  return undefined;
};

/** JSX expression at this component's own call site (e.g. PlanSection `plans={plans}`). */
export const resolveImmediatePropExpression = (
  graph: PageLogicGraph,
  consumerNodeId: string,
  propName: string
): string | undefined => {
  const consumer = nodesById(graph).get(consumerNodeId);
  return propExpressionFromNode(consumer, propName);
};

export const resolveImmediatePropLoc = (
  graph: PageLogicGraph,
  consumerNodeId: string,
  propName: string
): SourceLocation | undefined => {
  const consumer = nodesById(graph).get(consumerNodeId);
  return propLocFromNode(consumer, propName);
};

/** Outermost prop expression for data tracing (walks parent pass-through to `data.*`). */
export const resolvePropDataExpression = (
  graph: PageLogicGraph,
  consumerNodeId: string,
  propName: string
): string | undefined => {
  const byId = nodesById(graph);
  const immediate = resolveImmediatePropExpression(
    graph,
    consumerNodeId,
    propName
  );
  if (immediate?.includes(".")) {
    return immediate;
  }

  let parent = findRenderingParentComponent(graph, consumerNodeId);
  const visited = new Set<string>();
  while (parent && !visited.has(parent.id)) {
    visited.add(parent.id);
    const anchorId = resolveConsumerAnchorId(graph, parent.id);
    const anchor = byId.get(anchorId);
    const parentProp =
      propExpressionFromNode(parent, propName) ??
      propExpressionFromNode(anchor, propName);
    if (parentProp?.includes(".")) {
      return parentProp;
    }
    parent = findRenderingParentComponent(graph, parent.id);
  }

  const anchorId = resolveConsumerAnchorId(graph, consumerNodeId);
  const anchorProp = propExpressionFromNode(byId.get(anchorId), propName);
  return anchorProp ?? immediate;
};

export interface PropPassThroughStep {
  componentId: string;
  componentLabel: string;
  expression: string;
  loc?: SourceLocation;
}

const locKey = (loc: SourceLocation | undefined): string | undefined =>
  loc
    ? `${loc.filePath}:${loc.startLine}:${loc.startColumn}:${loc.endLine}:${loc.endColumn}`
    : undefined;

/**
 * Call-site prop steps from consumer up through pass-through parents (e.g. PlanSection
 * `plans={plans}` → PlansBlock `plans={data.plans}`) until a dotted expression is reached.
 */
export const collectPropPassThroughSteps = (
  graph: PageLogicGraph,
  consumerNodeId: string,
  propName: string
): PropPassThroughStep[] => {
  const byId = nodesById(graph);
  const steps: PropPassThroughStep[] = [];
  const seenLocs = new Set<string>();

  const pushStep = (nodeId: string): boolean => {
    const anchorId = resolveConsumerAnchorId(graph, nodeId);
    const expression =
      resolveImmediatePropExpression(graph, nodeId, propName) ??
      resolveImmediatePropExpression(graph, anchorId, propName);
    if (!expression) {
      return false;
    }

    const loc =
      resolveImmediatePropLoc(graph, nodeId, propName) ??
      resolveImmediatePropLoc(graph, anchorId, propName);
    const key = locKey(loc) ?? `${nodeId}:${propName}`;
    if (seenLocs.has(key)) {
      return false;
    }
    seenLocs.add(key);

    steps.push({
      componentId: nodeId,
      componentLabel: byId.get(nodeId)?.label ?? nodeId,
      expression,
      loc,
    });
    return true;
  };

  pushStep(consumerNodeId);

  let parent = findRenderingParentComponent(graph, consumerNodeId);
  const visited = new Set<string>();
  while (parent && !visited.has(parent.id)) {
    visited.add(parent.id);
    pushStep(parent.id);

    const dataExpr = resolvePropDataExpression(graph, parent.id, propName);
    if (dataExpr?.includes(".")) {
      break;
    }

    parent = findRenderingParentComponent(graph, parent.id);
  }

  return steps;
};

/**
 * @deprecated Prefer `resolveImmediatePropExpression` for loc and `resolvePropDataExpression` for tracing.
 */
export const resolveCallSitePropExpression = (
  graph: PageLogicGraph,
  consumerNodeId: string,
  propName: string
): string | undefined =>
  resolvePropDataExpression(graph, consumerNodeId, propName);

export interface ResolveExpressionOptions {
  /** When tracing a prop chip, skip hook-input matches that shadow parent pass-through. */
  skipHookInputMatch?: boolean;
  /** Skip conditions that merely read this identifier in `inputs`. */
  skipConditionInputMatch?: boolean;
}

export const resolveExpressionToNode = (
  graph: PageLogicGraph,
  expression: string,
  _contextNodeId?: string,
  options?: ResolveExpressionOptions
): LogicGraphNode | undefined => {
  const trimmed = expression.trim();
  const root = rootIdentifier(trimmed);

  const hookByOutput = graph.nodes.find(
    (node) =>
      node.type === "hook" &&
      node.hook?.outputs.some((field) => field.name === root)
  );
  if (hookByOutput) {
    return hookByOutput;
  }

  if (!options?.skipHookInputMatch) {
    const hookByInputSource = graph.nodes.find(
      (node) =>
        node.type === "hook" &&
        node.hook?.inputs.some(
          (field) =>
            field.source === trimmed ||
            field.source === root ||
            field.name === root
        )
    );
    if (hookByInputSource) {
      return hookByInputSource;
    }
  }

  const dataFetch = graph.nodes.find(
    (node) =>
      node.type === "data-fetch" &&
      (node.dataFetch?.outputNames?.includes(root) ||
        node.label.includes(root) ||
        node.dataFetch?.functionName === root)
  );
  if (dataFetch) {
    return dataFetch;
  }

  const contextNode = graph.nodes.find(
    (node) =>
      node.type === "context" &&
      (node.context?.outputNames?.includes(root) ||
        node.context?.contextName === root)
  );
  if (contextNode) {
    return contextNode;
  }

  const storeNode = graph.nodes.find(
    (node) =>
      node.type === "store" &&
      (node.store?.outputNames?.includes(root) ||
        node.store?.storeName === root)
  );
  if (storeNode) {
    return storeNode;
  }

  const condition = graph.nodes.find(
    (node) =>
      node.type === "condition" &&
      (node.condition?.expression === trimmed ||
        node.label === trimmed ||
        (!options?.skipConditionInputMatch &&
          node.condition?.inputs?.includes(root)))
  );
  if (condition) {
    return condition;
  }

  const loop = graph.nodes.find(
    (node) =>
      node.type === "loop" &&
      (node.loop?.sourceExpression === trimmed ||
        node.loop?.sourceExpression.startsWith(`${root}.`))
  );
  if (loop) {
    return loop;
  }

  return graph.nodes.find(
    (node) => node.label === trimmed || node.label === root
  );
};

const edgePriority = (edge: LogicGraphEdge): number => {
  if (edge.type === "condition-true" || edge.type === "condition-false") {
    return 0;
  }
  if (edge.type === "renders" || edge.type === "loop-renders") {
    return 1;
  }
  return 2;
};

export const getAncestorVisibilityConditions = (
  graph: PageLogicGraph,
  nodeId: string
): VisibilityCondition[] => {
  const byId = nodesById(graph);
  const conditions: VisibilityCondition[] = [];
  const visited = new Set<string>();
  let currentId: string | undefined = nodeId;

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const parents = incomingEdges(graph, currentId)
      .filter((edge) => UPSTREAM_EDGE_TYPES.has(edge.type))
      .toSorted((a, b) => edgePriority(a) - edgePriority(b));

    const parentEdge = parents[0];
    if (!parentEdge) {
      break;
    }

    const parent = byId.get(parentEdge.source);
    if (!parent) {
      break;
    }

    if (parent.type === "condition") {
      conditions.push({
        branch:
          parentEdge.type === "condition-false"
            ? "false"
            : (parentEdge.type === "condition-true"
              ? "true"
              : "and"),
        conditionNodeId: parent.id,
        expression: parent.condition?.expression ?? parent.label,
        inputs: parent.condition?.inputs ?? [],
        parentLabel: byId.get(currentId)?.label ?? currentId,
      });
    }

    currentId = parent.id;
  }

  return conditions;
};

const tracePropSource = (
  graph: PageLogicGraph,
  expression: string
): Pick<
  PropTrace,
  "sourceNodeId" | "sourceLabel" | "sourceType" | "sourceKind"
> => {
  const source = resolveExpressionToNode(graph, expression);
  if (!source) {
    return { sourceKind: "props" };
  }
  return {
    sourceKind: dataSourceKindForNode(source) ?? "props",
    sourceLabel: source.label,
    sourceNodeId: source.id,
    sourceType: source.type,
  };
};

const collectInboundDataSources = (
  graph: PageLogicGraph,
  nodeId: string
): DataSourceTrace[] => {
  const sources: DataSourceTrace[] = [];

  for (const edge of incomingEdges(graph, nodeId)) {
    if (edge.type === "passes-props" && edge.label) {
      sources.push({
        detail: `from parent via ${edge.label}`,
        kind: "props",
        label: edge.label,
      });
    }
    if (edge.type === "uses-hook" || edge.type === "calls") {
      const source = graph.nodes.find((node) => node.id === edge.source);
      if (!source) {
        continue;
      }
      const kind = dataSourceKindForNode(source);
      if (kind) {
        sources.push({
          detail: edge.label ?? edge.type,
          kind,
          label: source.label,
          nodeId: source.id,
        });
      }
    }
  }

  return sources;
};

export const buildNodeContext = (
  graph: PageLogicGraph,
  nodeId: string
): NodeContextView | undefined => {
  const node = graph.nodes.find((item) => item.id === nodeId);
  if (!node) {
    return undefined;
  }

  const visibilityConditions = getAncestorVisibilityConditions(graph, nodeId);

  const propsIn: PropTrace[] = (node.props ?? []).map((prop) => ({
    expression: prop.expression,
    name: prop.name,
    ...tracePropSource(graph, prop.expression),
  }));

  const rendersOut: RenderChild[] = outgoingEdges(graph, nodeId)
    .filter((edge) => DOWNSTREAM_EDGE_TYPES.has(edge.type))
    .map((edge) => {
      const child = graph.nodes.find((item) => item.id === edge.target);
      return {
        edgeLabel: edge.label,
        edgeType: edge.type,
        label: child?.label ?? edge.target,
        nodeId: edge.target,
        type: child?.type ?? "unknown",
      };
    });

  const dataSources = collectInboundDataSources(graph, nodeId);

  return {
    dataSources,
    node,
    propsIn,
    rendersOut,
    visibilityConditions,
  };
};

export const traceUpstream = (
  graph: PageLogicGraph,
  startNodeId: string,
  maxDepth = 10
): TraceStep[] => {
  const byId = nodesById(graph);
  const steps: TraceStep[] = [];
  const seen = new Set<string>([startNodeId]);
  const queue: { nodeId: string; depth: number }[] = [
    { depth: 0, nodeId: startNodeId },
  ];

  const focus = byId.get(startNodeId);
  if (focus) {
    steps.push({
      depth: 0,
      node: focus,
      nodeId: startNodeId,
      role: "focus",
    });
  }

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || current.depth >= maxDepth) {
      continue;
    }

    for (const edge of incomingEdges(graph, current.nodeId)) {
      if (!UPSTREAM_EDGE_TYPES.has(edge.type)) {
        continue;
      }
      if (seen.has(edge.source)) {
        continue;
      }
      seen.add(edge.source);
      const node = byId.get(edge.source);
      if (!node) {
        continue;
      }

      const depth = current.depth - 1;
      steps.push({
        depth,
        expression: edge.label,
        node,
        nodeId: node.id,
        role: roleForNode(node),
        via: edge.type,
      });
      queue.push({ depth, nodeId: node.id });
    }
  }

  return steps.toSorted((a, b) => a.depth - b.depth);
};

export const traceDownstream = (
  graph: PageLogicGraph,
  startNodeId: string,
  maxDepth = 6
): TraceStep[] => {
  const byId = nodesById(graph);
  const steps: TraceStep[] = [];
  const seen = new Set<string>([startNodeId]);
  const queue: { nodeId: string; depth: number }[] = [
    { depth: 0, nodeId: startNodeId },
  ];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || current.depth >= maxDepth) {
      continue;
    }

    for (const edge of outgoingEdges(graph, current.nodeId)) {
      if (!DOWNSTREAM_EDGE_TYPES.has(edge.type)) {
        continue;
      }
      if (seen.has(edge.target)) {
        continue;
      }
      seen.add(edge.target);
      const node = byId.get(edge.target);
      if (!node) {
        continue;
      }

      const depth = current.depth + 1;
      if (depth !== 0) {
        steps.push({
          depth,
          expression: edge.label,
          node,
          nodeId: node.id,
          role: roleForNode(node),
          via: edge.type,
        });
      }
      queue.push({ depth, nodeId: node.id });
    }
  }

  return steps.toSorted((a, b) => a.depth - b.depth);
};

export const traceIdentifier = (
  graph: PageLogicGraph,
  identifier: string,
  fromNodeId?: string
): TraceStep[] => {
  const sourceNode = resolveExpressionToNode(graph, identifier, fromNodeId);
  if (!sourceNode) {
    return [];
  }

  const chain = traceUpstream(graph, sourceNode.id, 8);
  const focus: TraceStep = {
    depth: 0,
    expression: identifier,
    node: sourceNode,
    nodeId: sourceNode.id,
    role: roleForNode(sourceNode),
  };

  if (chain.some((step) => step.nodeId === sourceNode.id)) {
    return chain.map((step) =>
      step.nodeId === sourceNode.id ? { ...step, expression: identifier } : step
    );
  }

  return [...chain.filter((step) => step.depth < 0), focus];
};

const appendUniqueStep = (
  steps: TraceStep[],
  seen: Set<string>,
  node: LogicGraphNode,
  depth: number,
  expression?: string
): void => {
  if (seen.has(node.id)) {
    return;
  }
  seen.add(node.id);
  steps.push({
    depth,
    expression,
    node,
    nodeId: node.id,
    role: roleForNode(node),
  });
};

const appendInputSources = (
  graph: PageLogicGraph,
  steps: TraceStep[],
  seen: Set<string>,
  expressions: string[],
  depth: number
): void => {
  for (const expression of expressions) {
    const source = resolveExpressionToNode(graph, expression);
    if (!source) {
      continue;
    }
    appendUniqueStep(steps, seen, source, depth, expression);
    if (source.type === "hook" && source.hook?.inputs.length) {
      appendInputSources(
        graph,
        steps,
        seen,
        source.hook.inputs
          .map((field) => field.source ?? field.name)
          .filter(Boolean),
        depth - 1
      );
    }
    if (source.type === "data-fetch") {
      continue;
    }
    if (source.type === "condition" && source.condition?.inputs?.length) {
      appendInputSources(
        graph,
        steps,
        seen,
        source.condition.inputs,
        depth - 1
      );
    }
  }
};

export const buildFocusDiagram = (
  graph: PageLogicGraph,
  focusNodeId: string
): FocusDiagram => {
  const focusNode = graph.nodes.find((item) => item.id === focusNodeId);
  const focus: TraceStep = {
    depth: 0,
    node: focusNode ?? {
      id: focusNodeId,
      label: focusNodeId,
      type: "unknown",
    },
    nodeId: focusNodeId,
    role: "focus",
  };

  const upstream: TraceStep[] = [];
  const seen = new Set<string>([focusNodeId]);
  let depth = -1;

  const visibility = getAncestorVisibilityConditions(graph, focusNodeId);
  for (const item of visibility.toReversed()) {
    const condNode = graph.nodes.find(
      (node) => node.id === item.conditionNodeId
    );
    if (condNode) {
      appendUniqueStep(upstream, seen, condNode, depth);
      depth -= 1;
      appendInputSources(graph, upstream, seen, item.inputs, depth);
      depth -= item.inputs.length > 0 ? 1 : 0;
    }
  }

  const context = buildNodeContext(graph, focusNodeId);
  if (context) {
    const propExpressions = context.propsIn.map((prop) => prop.expression);
    appendInputSources(graph, upstream, seen, propExpressions, depth);
  }

  if (focusNode?.hook?.inputs.length) {
    appendInputSources(
      graph,
      upstream,
      seen,
      focusNode.hook.inputs
        .map((field) => field.source ?? field.name)
        .filter(Boolean),
      depth - 1
    );
  }

  if (focusNode?.type === "component" || focusNode?.type === "page") {
    for (const edge of outgoingEdges(graph, focusNodeId)) {
      if (edge.type === "uses-hook") {
        const hookNode = graph.nodes.find((node) => node.id === edge.target);
        if (hookNode) {
          appendUniqueStep(upstream, seen, hookNode, depth - 1, "uses-hook");
        }
      }
      if (edge.type === "calls") {
        const dataNode = graph.nodes.find((node) => node.id === edge.target);
        if (dataNode) {
          appendUniqueStep(upstream, seen, dataNode, depth - 2, "calls");
        }
      }
    }
  }

  const downstream = traceDownstream(graph, focusNodeId, 6);
  const ordered = [
    ...upstream.toSorted((a, b) => a.depth - b.depth),
    focus,
    ...downstream,
  ];
  const links: TraceLink[] = [];

  for (let index = 0; index < ordered.length - 1; index += 1) {
    const from = ordered[index];
    const to = ordered[index + 1];
    if (!from || !to) {
      continue;
    }

    const edge =
      graph.edges.find(
        (item) => item.source === from.nodeId && item.target === to.nodeId
      ) ??
      graph.edges.find(
        (item) => item.source === to.nodeId && item.target === from.nodeId
      );

    links.push({
      fromNodeId: from.nodeId,
      id: `trace:${from.nodeId}:${to.nodeId}`,
      label: edge?.label ?? edge?.type ?? (to.depth > 0 ? "renders" : "feeds"),
      toNodeId: to.nodeId,
    });
  }

  return {
    focusNodeId,
    links,
    steps: ordered,
  };
};

export type TraceGroupKind = "data" | "logic" | "focus" | "ui";

export interface TraceStepGroup {
  id: TraceGroupKind;
  kind: TraceGroupKind;
  label: string;
  summary: string;
  steps: TraceStep[];
  defaultCollapsed: boolean;
}

const isDataStep = (step: TraceStep): boolean =>
  step.role === "data-source" ||
  step.node.type === "data-fetch" ||
  step.node.type === "context" ||
  step.node.type === "store";

const isLogicStep = (step: TraceStep): boolean =>
  step.role === "hook-logic" ||
  step.role === "visibility-condition" ||
  step.role === "loop-logic" ||
  step.role === "prop-input" ||
  step.node.type === "hook" ||
  step.node.type === "condition" ||
  step.node.type === "loop";

const isUiStep = (step: TraceStep): boolean =>
  step.role === "ui-output" ||
  step.node.type === "ui-content" ||
  step.node.type === "component";

const summarizeSteps = (steps: TraceStep[]): string => {
  const labels = steps.map((step) => step.node.label);
  if (labels.length <= 2) {
    return labels.join(", ");
  }
  return `${labels.slice(0, 2).join(", ")} +${labels.length - 2}`;
};

export const buildTraceStepGroups = (
  diagram: FocusDiagram
): TraceStepGroup[] => {
  const upstream = diagram.steps.filter((step) => step.depth < 0);
  const focus = diagram.steps.find((step) => step.depth === 0);
  const downstream = diagram.steps.filter((step) => step.depth > 0);

  const dataSteps = upstream.filter(isDataStep);
  const logicUpstream = upstream.filter(
    (step) => !isDataStep(step) && isLogicStep(step)
  );
  const logicDownstream = downstream.filter(isLogicStep);
  const uiSteps = downstream.filter(
    (step) => !isLogicStep(step) && isUiStep(step)
  );
  const otherDownstream = downstream.filter(
    (step) => !isLogicStep(step) && !isUiStep(step)
  );

  const logicSteps = [...logicUpstream, ...logicDownstream];
  const renderSteps = [...uiSteps, ...otherDownstream];

  const groups: TraceStepGroup[] = [];

  if (dataSteps.length > 0) {
    groups.push({
      defaultCollapsed: dataSteps.length > 1,
      id: "data",
      kind: "data",
      label: "Data",
      steps: dataSteps,
      summary: summarizeSteps(dataSteps),
    });
  }

  if (logicSteps.length > 0) {
    groups.push({
      defaultCollapsed: logicSteps.length > 1,
      id: "logic",
      kind: "logic",
      label: "Logic",
      steps: logicSteps,
      summary: summarizeSteps(logicSteps),
    });
  }

  if (focus) {
    groups.push({
      defaultCollapsed: false,
      id: "focus",
      kind: "focus",
      label: "Focus",
      steps: [focus],
      summary: focus.node.label,
    });
  }

  if (renderSteps.length > 0) {
    groups.push({
      defaultCollapsed: renderSteps.length > 1,
      id: "ui",
      kind: "ui",
      label: "UI output",
      steps: renderSteps,
      summary: summarizeSteps(renderSteps),
    });
  }

  return groups;
};
