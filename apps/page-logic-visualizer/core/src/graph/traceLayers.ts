import type {
  LogicGraphNode,
  PageLogicGraph,
  TraceLayer,
  TraceLayerGraph,
  TraceLayerNode,
  TraceLayerEdge,
} from "../types";
import { buildDataTraceChain, buildUiTree, flattenUiTree } from "./uiGraph";

const slug = (value: string): string =>
  value.replaceAll(/[^a-zA-Z0-9]+/g, "-").replaceAll(/^-|-$/g, "");

const nodeId = (layer: TraceLayer, key: string): string => `${layer}:${key}`;

const edgeId = (
  layer: TraceLayer,
  from: string,
  to: string,
  type: string
): string => `${layer}:edge:${from}:${to}:${type}`;

const addNode = (
  nodes: Map<string, TraceLayerNode>,
  node: TraceLayerNode
): void => {
  if (!nodes.has(node.id)) {
    nodes.set(node.id, node);
  }
};

const addEdge = (
  edges: TraceLayerEdge[],
  seen: Set<string>,
  edge: TraceLayerEdge
): void => {
  if (seen.has(edge.id)) {
    return;
  }
  seen.add(edge.id);
  edges.push(edge);
};

export const buildDependencyTrace = (
  graph: PageLogicGraph
): TraceLayerGraph => {
  const nodes = new Map<string, TraceLayerNode>();
  const edges: TraceLayerEdge[] = [];
  const seenEdges = new Set<string>();

  for (const file of graph.files) {
    const fileKey = slug(file.filePath);
    addNode(nodes, {
      file: file.filePath,
      id: nodeId("dependency", `file:${fileKey}`),
      label: file.filePath.split("/").pop() ?? file.filePath,
      layer: "dependency",
      meta: {
        importCount: file.importCount,
        isLayout: file.isLayout,
        isPage: file.isPage,
      },
      type: "file",
    });
  }

  for (const graphNode of graph.nodes) {
    if (!graphNode.filePath) {
      continue;
    }

    const sourceFileId = nodeId(
      "dependency",
      `file:${slug(graphNode.filePath)}`
    );
    addNode(nodes, {
      file: graphNode.filePath,
      id: sourceFileId,
      label: graphNode.filePath.split("/").pop() ?? graphNode.filePath,
      layer: "dependency",
      type: "file",
    });

    if (graphNode.importPath) {
      const moduleKey = slug(graphNode.importPath);
      const moduleNodeId = nodeId("dependency", `module:${moduleKey}`);
      const isWorkspace =
        graphNode.packageName?.startsWith("@cs/") ||
        graphNode.packageName?.startsWith("@repo/") ||
        Boolean(graphNode.importPath?.includes("packages/"));

      addNode(nodes, {
        file: graphNode.filePath,
        id: moduleNodeId,
        label: graphNode.label,
        layer: "dependency",
        meta: {
          importKind: graphNode.type === "dynamic-import" ? "dynamic" : "named",
          importPath: graphNode.importPath,
          isWorkspacePackage: isWorkspace,
          packageName: graphNode.packageName,
        },
        type: isWorkspace
          ? "workspace-package"
          : (graphNode.packageName
            ? "external-package"
            : "module"),
      });

      addEdge(edges, seenEdges, {
        from: sourceFileId,
        id: edgeId("dependency", sourceFileId, moduleNodeId, "imports"),
        label: graphNode.importPath,
        layer: "dependency",
        to: moduleNodeId,
        type: "imports",
      });

      if (graphNode.filePath !== graphNode.importPath) {
        const resolvedId = nodeId(
          "dependency",
          `resolved:${slug(graphNode.filePath)}:${slug(graphNode.label)}`
        );
        addNode(nodes, {
          file: graphNode.filePath,
          id: resolvedId,
          label: graphNode.label,
          layer: "dependency",
          meta: {
            exportName: graphNode.exportName,
            resolvedPath: graphNode.filePath,
          },
          type: "module",
        });
        addEdge(edges, seenEdges, {
          from: moduleNodeId,
          id: edgeId("dependency", moduleNodeId, resolvedId, "resolved-to"),
          layer: "dependency",
          to: resolvedId,
          type: "resolved-to",
        });
      }
    }
  }

  return {
    edges,
    layer: "dependency",
    nodes: [...nodes.values()],
    target: graph.entryFile,
  };
};

export const buildDataSourceTrace = (
  graph: PageLogicGraph
): TraceLayerGraph => {
  const nodes: TraceLayerNode[] = [];
  const edges: TraceLayerEdge[] = [];
  const seenEdges = new Set<string>();
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));

  for (const graphNode of graph.nodes) {
    if (graphNode.type !== "data-fetch" || !graphNode.dataFetch) {
      continue;
    }

    const fetch = graphNode.dataFetch;
    const fetchId = nodeId("data-source", graphNode.id);
    const client =
      fetch.sourceKind === "api"
        ? "fetch"
        : (fetch.apiCalls?.length
          ? "fetch"
          : "custom");

    nodes.push({
      code: fetch.callExpression,
      file: graphNode.filePath,
      id: fetchId,
      label: fetch.callExpression,
      layer: "data-source",
      line: graphNode.loc?.startLine,
      meta: {
        apiCalls: fetch.apiCalls,
        awaited: fetch.awaited,
        client,
        functionName: fetch.functionName,
        importPath: fetch.importPath,
        returnType: fetch.returnType,
      },
      type: fetch.awaited ? "api-call" : "data-fetch",
    });

    const parentEdge = graph.edges.find((edge) => edge.target === graphNode.id);
    if (parentEdge) {
      const parent = nodesById.get(parentEdge.source);
      if (parent) {
        const parentTraceId = nodeId("data-source", `parent:${parent.id}`);
        if (!nodes.some((node) => node.id === parentTraceId)) {
          nodes.push({
            file: parent.filePath,
            id: parentTraceId,
            label: parent.label,
            layer: "data-source",
            type: parent.type === "page" ? "page" : "component",
          });
        }
        addEdge(edges, seenEdges, {
          from: parentTraceId,
          id: edgeId("data-source", parentTraceId, fetchId, "calls"),
          layer: "data-source",
          to: fetchId,
          type: fetch.awaited ? "awaits" : "calls",
        });
      }
    }

    for (const outputName of fetch.outputNames ?? []) {
      const outputId = nodeId(
        "data-source",
        `${graphNode.id}:out:${outputName}`
      );
      nodes.push({
        file: graphNode.filePath,
        id: outputId,
        label: outputName,
        layer: "data-source",
        type: "variable",
      });
      addEdge(edges, seenEdges, {
        from: fetchId,
        id: edgeId("data-source", fetchId, outputId, "returns-data"),
        layer: "data-source",
        to: outputId,
        type: "returns-data",
      });
    }
  }

  for (const graphNode of graph.nodes) {
    if (graphNode.type !== "hook" || !graphNode.hook) {
      continue;
    }
    if (
      graphNode.hook.hookName !== "useQuery" &&
      graphNode.hook.hookName !== "useSWR"
    ) {
      continue;
    }

    const hookId = nodeId("data-source", graphNode.id);
    nodes.push({
      code: graphNode.hook.callExpression,
      file: graphNode.filePath,
      id: hookId,
      label: graphNode.hook.callExpression,
      layer: "data-source",
      line: graphNode.loc?.startLine,
      meta: {
        client:
          graphNode.hook.hookName === "useQuery" ? "tanstack-query" : "swr",
        hookName: graphNode.hook.hookName,
      },
      type: "query-hook",
    });

    for (const output of graphNode.hook.outputs) {
      const outputId = nodeId("data-source", `${graphNode.id}:${output.name}`);
      nodes.push({
        file: graphNode.filePath,
        id: outputId,
        label: output.name,
        layer: "data-source",
        meta: { source: output.source },
        type: "variable",
      });
      addEdge(edges, seenEdges, {
        from: hookId,
        id: edgeId("data-source", hookId, outputId, "returns-data"),
        layer: "data-source",
        to: outputId,
        type: "returns-data",
      });
    }
  }

  return {
    edges,
    layer: "data-source",
    nodes,
    target: graph.entryFile,
  };
};

export const buildStateStoreTrace = (
  graph: PageLogicGraph
): TraceLayerGraph => {
  const nodes: TraceLayerNode[] = [];
  const edges: TraceLayerEdge[] = [];
  const seenEdges = new Set<string>();

  for (const graphNode of graph.nodes) {
    if (graphNode.locals) {
      for (const variable of graphNode.locals.variables) {
        const hookName = variable.sourceHook;
        if (!hookName) {
          continue;
        }
        const sourceId = nodeId(
          "state-store",
          `local:${graphNode.id}:${hookName}`
        );
        if (!nodes.some((node) => node.id === sourceId)) {
          const isContext = hookName === "useContext";
          const isStore =
            hookName.includes("Store") || hookName.includes("store");
          nodes.push({
            code: variable.expression,
            file: graphNode.filePath,
            id: sourceId,
            label: hookName,
            layer: "state-store",
            type: isContext
              ? "context"
              : (isStore
                ? "zustand-store"
                : "react-state"),
          });
        }
        const outId = nodeId("state-store", `${graphNode.id}:${variable.name}`);
        nodes.push({
          file: graphNode.filePath,
          id: outId,
          label: variable.name,
          layer: "state-store",
          meta: { sourceHook: hookName },
          type: hookName.startsWith("set") ? "state-setter" : "react-state",
        });
        addEdge(edges, seenEdges, {
          from: sourceId,
          id: edgeId("state-store", sourceId, outId, "reads"),
          layer: "state-store",
          to: outId,
          type: "reads",
        });
      }

      for (const variable of graphNode.locals.variables) {
        if (variable.sourceHook) {
          continue;
        }
        const looksLikeState =
          /^(is|has|show|selected|preview|sidebar|open|active)/i.test(
            variable.name
          ) || variable.name.endsWith("Mode");
        if (!looksLikeState) {
          continue;
        }
        const derivedId = nodeId(
          "state-store",
          `derived:${graphNode.id}:${variable.name}`
        );
        nodes.push({
          code: variable.expression,
          file: graphNode.filePath,
          id: derivedId,
          label: variable.name,
          layer: "state-store",
          meta: { owner: graphNode.label },
          type: "react-state",
        });
      }
    }

    if (graphNode.type === "context" && graphNode.context) {
      const ctxId = nodeId("state-store", graphNode.id);
      nodes.push({
        code: graphNode.context.callExpression,
        file: graphNode.filePath,
        id: ctxId,
        label: graphNode.context.contextName,
        layer: "state-store",
        line: graphNode.loc?.startLine,
        meta: { importPath: graphNode.context.importPath },
        type: "context",
      });
      for (const outputName of graphNode.context.outputNames ?? []) {
        const outId = nodeId("state-store", `${graphNode.id}:${outputName}`);
        nodes.push({
          file: graphNode.filePath,
          id: outId,
          label: outputName,
          layer: "state-store",
          type: "react-state",
        });
        addEdge(edges, seenEdges, {
          from: ctxId,
          id: edgeId("state-store", ctxId, outId, "reads"),
          layer: "state-store",
          to: outId,
          type: "reads",
        });
      }
    }

    if (graphNode.type === "store" && graphNode.store) {
      const storeId = nodeId("state-store", graphNode.id);
      nodes.push({
        code: graphNode.store.callExpression,
        file: graphNode.filePath,
        id: storeId,
        label: graphNode.store.storeName,
        layer: "state-store",
        line: graphNode.loc?.startLine,
        meta: {
          library: graphNode.store.library,
          selector: graphNode.store.selector,
        },
        type: "zustand-store",
      });
      for (const outputName of graphNode.store.outputNames ?? []) {
        const outId = nodeId("state-store", `${graphNode.id}:${outputName}`);
        nodes.push({
          file: graphNode.filePath,
          id: outId,
          label: outputName,
          layer: "state-store",
          type: "react-state",
        });
        addEdge(edges, seenEdges, {
          from: storeId,
          id: edgeId("state-store", storeId, outId, "selects"),
          layer: "state-store",
          to: outId,
          type: "selects",
        });
      }
    }

    if (graphNode.type === "hook" && graphNode.hook) {
      const { hookName } = graphNode.hook;
      if (hookName !== "useState" && hookName !== "useReducer") {
        continue;
      }

      const hookId = nodeId("state-store", graphNode.id);
      nodes.push({
        code: graphNode.hook.callExpression,
        file: graphNode.filePath,
        id: hookId,
        label: graphNode.hook.callExpression,
        layer: "state-store",
        line: graphNode.loc?.startLine,
        type: hookName === "useReducer" ? "reducer-state" : "react-state",
      });

      for (const output of graphNode.hook.outputs) {
        const outId = nodeId("state-store", `${graphNode.id}:${output.name}`);
        const isSetter =
          output.name.startsWith("set") && output.name.length > 3;
        nodes.push({
          file: graphNode.filePath,
          id: outId,
          label: output.name,
          layer: "state-store",
          meta: { kind: output.kind, source: output.source },
          type: isSetter ? "state-setter" : "react-state",
        });
        addEdge(edges, seenEdges, {
          from: hookId,
          id: edgeId("state-store", hookId, outId, "initializes"),
          label: output.source,
          layer: "state-store",
          to: outId,
          type: isSetter ? "updates" : "initializes",
        });

        for (const usage of output.usedIn ?? []) {
          const usageId = nodeId("state-store", `usage:${slug(usage)}`);
          nodes.push({
            id: usageId,
            label: usage,
            layer: "state-store",
            type: "unknown",
          });
          addEdge(edges, seenEdges, {
            from: outId,
            id: edgeId("state-store", outId, usageId, "used-by"),
            layer: "state-store",
            to: usageId,
            type: "used-by",
          });
        }
      }
    }
  }

  return {
    edges,
    layer: "state-store",
    nodes,
    target: graph.entryFile,
  };
};

const isEventProp = (name: string): boolean => /^on[A-Z]/.test(name);

const classifyEventCall = (expression: string): string => {
  if (/router\.(push|replace|back|refresh)/.test(expression)) {
    return "router-action";
  }
  if (/track\(|analytics\.|gtag\(|posthog\./.test(expression)) {
    return "analytics-event";
  }
  if (/^set[A-Z]/.test(expression.split("(")[0] ?? "")) {
    return "state-update";
  }
  if (/mutate\(|useMutation|submit/.test(expression)) {
    return "api-mutation";
  }
  return "function-call";
};

export const buildEventActionTrace = (
  graph: PageLogicGraph
): TraceLayerGraph => {
  const nodes: TraceLayerNode[] = [];
  const edges: TraceLayerEdge[] = [];
  const seenEdges = new Set<string>();
  const seenEventIds = new Set<string>();

  const addEventFromProp = (
    ownerLabel: string,
    ownerFile: string | undefined,
    prop: { name: string; expression: string; loc?: { startLine: number } }
  ) => {
    if (!isEventProp(prop.name)) {
      return;
    }

    const eventKey = `${ownerLabel}:${prop.name}:${prop.expression}`;
    if (seenEventIds.has(eventKey)) {
      return;
    }
    seenEventIds.add(eventKey);

    const isInline =
      prop.expression.includes("=>") || prop.expression.startsWith("function");
    const handlerType = isInline ? "inline-handler" : "callback-handler";
    const eventId = nodeId(
      "event-action",
      `${slug(ownerLabel)}:${prop.name}:${slug(prop.expression)}`
    );

    nodes.push({
      code: prop.expression,
      file: ownerFile,
      id: eventId,
      label: `${ownerLabel}.${prop.name}`,
      layer: "event-action",
      line: prop.loc?.startLine,
      meta: {
        eventName: prop.name,
        handlerName: isInline ? undefined : prop.expression,
        targetComponent: ownerLabel,
      },
      type: "event-handler",
    });

    const handlerId = nodeId("event-action", `handler:${eventId}`);
    nodes.push({
      code: prop.expression,
      file: ownerFile,
      id: handlerId,
      label: isInline ? "inline handler" : prop.expression,
      layer: "event-action",
      type: handlerType,
    });

    addEdge(edges, seenEdges, {
      from: eventId,
      id: edgeId("event-action", eventId, handlerId, "triggered-by"),
      layer: "event-action",
      to: handlerId,
      type: "triggered-by",
    });

    if (isInline) {
      const setterMatch = prop.expression.match(/set[A-Z]\w+/);
      const callMatch = prop.expression.match(/([a-zA-Z_$][\w$]*)\s*\(/);
      const callee = callMatch?.[1];
      if (setterMatch) {
        const setterId = nodeId(
          "event-action",
          `setter:${setterMatch[0]}:${eventId}`
        );
        nodes.push({
          id: setterId,
          label: setterMatch[0],
          layer: "event-action",
          type: "state-update",
        });
        addEdge(edges, seenEdges, {
          from: handlerId,
          id: edgeId("event-action", handlerId, setterId, "updates-state"),
          layer: "event-action",
          to: setterId,
          type: "updates-state",
        });
      } else if (callee && callee !== "function") {
        const callId = nodeId(
          "event-action",
          `call:${slug(callee)}:${eventId}`
        );
        nodes.push({
          id: callId,
          label: callee,
          layer: "event-action",
          type: classifyEventCall(callee),
        });
        addEdge(edges, seenEdges, {
          from: handlerId,
          id: edgeId("event-action", handlerId, callId, "calls"),
          layer: "event-action",
          to: callId,
          type: "calls",
        });
      }
    } else {
      const callId = nodeId(
        "event-action",
        `call:${slug(prop.expression)}:${eventId}`
      );
      nodes.push({
        id: callId,
        label: prop.expression,
        layer: "event-action",
        type: classifyEventCall(prop.expression),
      });
      addEdge(edges, seenEdges, {
        from: handlerId,
        id: edgeId("event-action", handlerId, callId, "calls"),
        layer: "event-action",
        to: callId,
        type: "calls",
      });
    }
  };

  for (const graphNode of graph.nodes) {
    for (const prop of graphNode.props ?? []) {
      addEventFromProp(graphNode.label, graphNode.filePath, prop);
    }
  }

  const uiTree = buildUiTree(graph);
  if (uiTree) {
    for (const treeNode of flattenUiTree(uiTree)) {
      for (const render of treeNode.renders) {
        for (const prop of render.props) {
          addEventFromProp(
            `${treeNode.node.label} → ${render.label}`,
            treeNode.node.filePath,
            prop
          );
        }
      }

      for (const fn of treeNode.locals.functions) {
        if (!fn.name.startsWith("handle") && !fn.name.startsWith("on")) {
          continue;
        }
        const fnId = nodeId("event-action", `fn:${treeNode.nodeId}:${fn.name}`);
        nodes.push({
          code: fn.expression,
          file: treeNode.node.filePath,
          id: fnId,
          label: `${treeNode.node.label}.${fn.name}`,
          layer: "event-action",
          meta: { handlerName: fn.name },
          type: "callback-handler",
        });
      }
    }
  }

  return {
    edges,
    layer: "event-action",
    nodes,
    target: graph.entryFile,
  };
};

export interface DataFlowTraceOptions {
  expression: string;
  consumerNodeId: string;
}

export const buildDataFlowTrace = (
  graph: PageLogicGraph,
  options: DataFlowTraceOptions
): TraceLayerGraph => {
  const chain = buildDataTraceChain(
    graph,
    options.expression,
    options.consumerNodeId,
    buildUiTree(graph)
  );

  const nodes: TraceLayerNode[] = chain.steps.map((step) => ({
    code: step.expression,
    file: step.sourceFilePath ?? step.loc?.filePath,
    id: nodeId("data-flow", step.nodeId),
    label: step.label,
    layer: "data-flow",
    line: step.loc?.startLine,
    meta: { role: step.stepRole, searchText: step.searchText },
    type: stepRoleToNodeType(step.stepRole ?? "unknown"),
  }));

  const edges: TraceLayerEdge[] = [];
  for (let index = 0; index < chain.steps.length - 1; index += 1) {
    const from = chain.steps[index]!;
    const to = chain.steps[index + 1]!;
    edges.push({
      from: nodeId("data-flow", from.nodeId),
      id: edgeId("data-flow", from.nodeId, to.nodeId, "depends-on"),
      layer: "data-flow",
      to: nodeId("data-flow", to.nodeId),
      type: index === 0 ? "assigned-to" : "depends-on",
    });
  }

  return {
    edges,
    layer: "data-flow",
    nodes,
    target: options.expression,
  };
};

const stepRoleToNodeType = (role: string): string => {
  switch (role) {
    case "hook": {
      return "hook-result";
    }
    case "variable": {
      return "variable";
    }
    case "prop": {
      return "jsx-prop";
    }
    case "api-call":
    case "await-call": {
      return "function-result";
    }
    case "function": {
      return "transform";
    }
    default: {
      return "unknown";
    }
  }
};

export const buildAllTraceLayers = (
  graph: PageLogicGraph
): Record<TraceLayer, TraceLayerGraph> => ({
  component: buildComponentLayerSummary(graph),
  "data-flow": {
    edges: [],
    layer: "data-flow",
    nodes: [],
    target: graph.entryFile,
  },
  "data-source": buildDataSourceTrace(graph),
  dependency: buildDependencyTrace(graph),
  "event-action": buildEventActionTrace(graph),
  hook: { edges: [], layer: "hook", nodes: [], target: graph.entryFile },
  route: buildRouteLayerSummary(graph),
  "state-store": buildStateStoreTrace(graph),
});

const buildRouteLayerSummary = (graph: PageLogicGraph): TraceLayerGraph => {
  const nodes: TraceLayerNode[] = [];
  const edges: TraceLayerEdge[] = [];
  const seenEdges = new Set<string>();

  for (const entry of graph.routeChain ?? []) {
    nodes.push({
      file: entry.filePath,
      id: nodeId("route", entry.nodeId),
      label: entry.label,
      layer: "route",
      type: entry.kind,
    });
  }

  const chain = graph.routeChain ?? [];
  for (let index = 0; index < chain.length - 1; index += 1) {
    const from = chain[index]!;
    const to = chain[index + 1]!;
    addEdge(edges, seenEdges, {
      from: nodeId("route", from.nodeId),
      id: edgeId("route", from.nodeId, to.nodeId, "children-slot"),
      layer: "route",
      to: nodeId("route", to.nodeId),
      type: "children-slot",
    });
  }

  return { edges, layer: "route", nodes, target: graph.entryFile };
};

const buildComponentLayerSummary = (graph: PageLogicGraph): TraceLayerGraph => {
  const nodes: TraceLayerNode[] = graph.nodes
    .filter((node) =>
      ["route", "layout", "page", "component", "condition", "loop"].includes(
        node.type
      )
    )
    .map((node) => ({
      file: node.filePath,
      id: nodeId("component", node.id),
      label: node.label,
      layer: "component" as const,
      line: node.loc?.startLine,
      type: node.type,
    }));

  const idMap = new Map(graph.nodes.map((node) => [node.id, node]));
  const edges: TraceLayerEdge[] = [];
  const seenEdges = new Set<string>();

  for (const edge of graph.edges) {
    if (!idMap.has(edge.source) || !idMap.has(edge.target)) {
      continue;
    }
    addEdge(edges, seenEdges, {
      from: nodeId("component", edge.source),
      id: edgeId("component", edge.source, edge.target, edge.type),
      label: edge.label,
      layer: "component",
      to: nodeId("component", edge.target),
      type: edge.type,
    });
  }

  return { edges, layer: "component", nodes, target: graph.rootNodeId };
};

export const filterTraceLayerGraph = (
  layerGraph: TraceLayerGraph,
  query: string
): TraceLayerGraph => {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return layerGraph;
  }

  const matchedNodeIds = new Set(
    layerGraph.nodes
      .filter(
        (node) =>
          node.label.toLowerCase().includes(normalized) ||
          node.file?.toLowerCase().includes(normalized) ||
          node.code?.toLowerCase().includes(normalized)
      )
      .map((node) => node.id)
  );

  const nodes = layerGraph.nodes.filter((node) => matchedNodeIds.has(node.id));
  const nodeIdSet = new Set(nodes.map((node) => node.id));
  const edges = layerGraph.edges.filter(
    (edge) => nodeIdSet.has(edge.from) && nodeIdSet.has(edge.to)
  );

  return { ...layerGraph, edges, nodes };
};
