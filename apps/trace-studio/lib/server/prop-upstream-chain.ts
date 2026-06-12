import type { DbSymbol, TraceDatabase } from "@ai-trace/cache";
import { collectExpandedEdges, getEdgesForSymbol } from "@ai-trace/cache";
import type { DataFlowNode, RouteInfo } from "@ai-trace/types";

import type { TraceEdge, TraceNode } from "../types";

type RawEdge = ReturnType<typeof collectExpandedEdges>[number];

const CHAIN_EDGE_TYPES = new Set([
  "prop_source",
  "passes_prop",
  "sequence",
  "calls",
  "uses_hook",
]);

const MAX_RECURSE_DEPTH = 6;

export function propSinkId(componentId: string, propName: string): string {
  return `prop:${componentId}:${propName}`;
}

function stepNodeId(ownerId: string, line: number, name: string): string {
  return `step:${ownerId}:${line}:${name}`;
}

function matchesPropName(
  edge: RawEdge,
  propName: string,
  receiverId: string
): boolean {
  if (edge.type !== "prop_source" || edge.to !== receiverId) {
    return false;
  }

  return (
    String(edge.metadata?.propName ?? "").toLowerCase() ===
    propName.toLowerCase()
  );
}

function makeTraceEdge(edge: RawEdge): TraceEdge {
  return {
    from: edge.from,
    id: edge.id,
    metadata: edge.metadata as TraceEdge["metadata"],
    to: edge.to,
    type: edge.type,
  };
}

function primaryCalleeFromFlow(flow: DataFlowNode): string | null {
  if (flow.kind === "call" || flow.kind === "hook_call") {
    return flow.callee ?? flow.name ?? null;
  }

  for (const child of flow.children ?? []) {
    const nested = primaryCalleeFromFlow(child);
    if (nested) {
      return nested;
    }
  }

  return null;
}

function collectPoolForOwners(
  db: TraceDatabase,
  ownerIds: string[]
): RawEdge[] {
  const merged = new Map<string, RawEdge>();

  for (const ownerId of ownerIds) {
    for (const edge of collectExpandedEdges(db, ownerId, {
      depth: 5,
      edgeTypes: CHAIN_EDGE_TYPES,
    })) {
      merged.set(edge.id, edge);
    }

    for (const edge of getEdgesForSymbol(db, ownerId)) {
      if (!CHAIN_EDGE_TYPES.has(edge.type)) {
        continue;
      }
      merged.set(edge.id, edge);
    }
  }

  return [...merged.values()];
}

function findPassesPropEdge(
  pool: RawEdge[],
  parentId: string,
  childId: string,
  propName: string
): RawEdge | undefined {
  const focusLower = propName.toLowerCase();

  return pool.find((edge) => {
    if (
      edge.type !== "passes_prop" ||
      edge.from !== parentId ||
      edge.to !== childId
    ) {
      return false;
    }

    const attributes = edge.metadata?.attributes;
    if (!Array.isArray(attributes)) {
      return false;
    }

    return attributes.some(
      (attr) =>
        String((attr as { name: string }).name).toLowerCase() === focusLower
    );
  });
}

interface ChainBuilder {
  nodes: Map<string, TraceNode>;
  edges: Map<string, RawEdge>;
  symbols: DbSymbol[];
  routes: RouteInfo[];
  pool: RawEdge[];
}

function ensureSymbolNode(builder: ChainBuilder, symbolId: string): void {
  if (builder.nodes.has(symbolId)) {
    return;
  }

  if (symbolId.startsWith("builtin:")) {
    builder.nodes.set(symbolId, {
      id: symbolId,
      label: symbolId.slice("builtin:".length),
      traceable: false,
      type: "builtin",
    });
    return;
  }

  if (symbolId.startsWith("external:")) {
    builder.nodes.set(symbolId, {
      id: symbolId,
      label: symbolId.slice("external:".length).replace("#", " · "),
      traceable: false,
      type: "external",
    });
    return;
  }

  const symbol = builder.symbols.find((item) => item.id === symbolId);
  if (!symbol) {
    return;
  }

  builder.nodes.set(symbolId, {
    endLine: symbol.endLine,
    filePath: symbol.filePath,
    id: symbol.id,
    label: symbol.name,
    startLine: symbol.startLine,
    traceable: true,
    type:
      symbol.type === "hook"
        ? "hook"
        : symbol.type === "service"
          ? "service"
          : symbol.type === "component"
            ? "component"
            : "function",
  });
}

function ensureStepNode(
  builder: ChainBuilder,
  ownerId: string,
  flow: DataFlowNode,
  name: string
): string {
  const id = stepNodeId(ownerId, flow.line, name);
  if (!builder.nodes.has(id)) {
    const owner = builder.symbols.find((item) => item.id === ownerId);
    builder.nodes.set(id, {
      endLine: owner?.endLine,
      filePath: owner?.filePath,
      id,
      label: flow.expression,
      metadata: { line: flow.line, stepKind: flow.kind },
      startLine: owner?.startLine,
      traceable: true,
      type: "variable",
    });
  }

  return id;
}

function addChainEdge(
  builder: ChainBuilder,
  from: string,
  to: string,
  type: string,
  metadata?: Record<string, unknown>,
  edgeKey?: string
): void {
  const id =
    edgeKey ?? `${from}->${to}:${type}:${String(metadata?.line ?? "")}`;
  if (builder.edges.has(id)) {
    return;
  }

  builder.edges.set(id, {
    from,
    id,
    metadata,
    to,
    type,
  } as RawEdge);
}

/** Walk parsed sourceFlow: upstream steps point toward `targetId`. */
function walkSourceFlowChain(
  builder: ChainBuilder,
  flow: DataFlowNode,
  ownerId: string,
  targetId: string,
  leafSymbolId: string
): string {
  if (flow.kind === "call" || flow.kind === "hook_call") {
    ensureSymbolNode(builder, leafSymbolId);
    addChainEdge(builder, leafSymbolId, targetId, "prop_source", {
      expression: flow.expression,
      line: flow.line,
      propName: builder.nodes.get(targetId)?.label,
    });
    return leafSymbolId;
  }

  if (flow.kind === "await" && flow.children?.[0]) {
    return walkSourceFlowChain(
      builder,
      flow.children[0],
      ownerId,
      targetId,
      leafSymbolId
    );
  }

  if (flow.kind === "member" && flow.children?.[0]) {
    const objectId = walkSourceFlowChain(
      builder,
      flow.children[0],
      ownerId,
      targetId,
      leafSymbolId
    );
    const stepId = ensureStepNode(
      builder,
      ownerId,
      flow,
      flow.property ?? "member"
    );
    addChainEdge(builder, objectId, stepId, "sequence", {
      expression: flow.expression,
      line: flow.line,
      stepKind: "member",
    });
    addChainEdge(builder, stepId, targetId, "prop_source", {
      line: flow.line,
      propName: builder.nodes.get(targetId)?.label,
    });
    return stepId;
  }

  if (flow.kind === "identifier" && flow.children?.length) {
    const stepId = ensureStepNode(
      builder,
      ownerId,
      flow,
      flow.name ?? "binding"
    );
    const childLeaf = walkSourceFlowChain(
      builder,
      flow.children[0],
      ownerId,
      stepId,
      leafSymbolId
    );
    if (childLeaf !== stepId) {
      addChainEdge(builder, childLeaf, stepId, "sequence", {
        expression: flow.expression,
        line: flow.line,
        stepKind: "binding",
      });
    }
    addChainEdge(builder, stepId, targetId, "prop_source", {
      line: flow.line,
      propName: builder.nodes.get(targetId)?.label,
    });
    return stepId;
  }

  if (flow.kind === "parameter" && flow.name) {
    const parentPropSink = propSinkId(ownerId, flow.name);
    if (!builder.nodes.has(parentPropSink)) {
      builder.nodes.set(parentPropSink, {
        id: parentPropSink,
        label: flow.name,
        metadata: { ownerComponentId: ownerId },
        traceable: false,
        type: "prop",
      });
    }
    addChainEdge(builder, parentPropSink, targetId, "prop_source", {
      line: flow.line,
      propName: builder.nodes.get(targetId)?.label,
    });
    return parentPropSink;
  }

  if (flow.kind === "identifier" && flow.name) {
    const stepId = ensureStepNode(builder, ownerId, flow, flow.name);
    addChainEdge(builder, stepId, targetId, "prop_source", {
      line: flow.line,
      propName: builder.nodes.get(targetId)?.label,
    });
    return stepId;
  }

  ensureSymbolNode(builder, leafSymbolId);
  addChainEdge(builder, leafSymbolId, targetId, "prop_source", {
    expression: flow.expression,
    line: flow.line,
  });
  return leafSymbolId;
}

function linkParentPass(
  builder: ChainBuilder,
  parentId: string,
  childId: string,
  sinkId: string,
  propName: string,
  line?: number
): void {
  ensureSymbolNode(builder, parentId);

  const passEdge = findPassesPropEdge(
    builder.pool,
    parentId,
    childId,
    propName
  );

  addChainEdge(
    builder,
    parentId,
    sinkId,
    "passes_prop",
    {
      ...passEdge?.metadata,
      line: line ?? passEdge?.metadata?.line,
      propName,
    },
    passEdge?.id ?? `${parentId}->${sinkId}:passes_prop:${propName}`
  );
}

function linkParentSequenceToSource(
  builder: ChainBuilder,
  parentId: string,
  sourceId: string,
  flow?: DataFlowNode
): void {
  const seqEdge = builder.pool.find(
    (edge) =>
      edge.type === "sequence" && edge.from === parentId && edge.to === sourceId
  );

  if (seqEdge) {
    addChainEdge(
      builder,
      parentId,
      sourceId,
      "sequence",
      seqEdge.metadata,
      seqEdge.id
    );
    return;
  }

  const callee = flow ? primaryCalleeFromFlow(flow) : undefined;
  if (!callee) {
    return;
  }

  const callEdge = builder.pool.find(
    (edge) =>
      (edge.type === "calls" || edge.type === "sequence") &&
      edge.from === parentId &&
      String(edge.metadata?.callee ?? "").includes(
        callee.split(".")[0] ?? callee
      )
  );

  if (callEdge) {
    addChainEdge(
      builder,
      parentId,
      sourceId,
      callEdge.type,
      callEdge.metadata,
      callEdge.id
    );
  }
}

function tracePropOnComponent(
  builder: ChainBuilder,
  componentId: string,
  propName: string,
  sinkId: string,
  depth: number
): void {
  if (depth > MAX_RECURSE_DEPTH) {
    return;
  }

  const propSources = builder.pool.filter((edge) =>
    matchesPropName(edge, propName, componentId)
  );

  for (const propEdge of propSources) {
    const sourceId = propEdge.from;
    const passedFrom = propEdge.metadata?.passedFrom as string | undefined;
    const sourceFlow = propEdge.metadata?.sourceFlow as
      | DataFlowNode
      | undefined;

    ensureSymbolNode(builder, sourceId);

    if (sourceFlow) {
      walkSourceFlowChain(
        builder,
        sourceFlow,
        passedFrom ?? componentId,
        sinkId,
        sourceId
      );
    } else {
      addChainEdge(
        builder,
        sourceId,
        sinkId,
        "prop_source",
        propEdge.metadata,
        propEdge.id
      );
    }

    if (passedFrom) {
      linkParentPass(
        builder,
        passedFrom,
        componentId,
        sinkId,
        propName,
        propEdge.metadata?.line as number | undefined
      );
      linkParentSequenceToSource(builder, passedFrom, sourceId, sourceFlow);

      const parentCallee = sourceFlow
        ? primaryCalleeFromFlow(sourceFlow)
        : undefined;
      if (sourceFlow?.kind === "parameter" && sourceFlow.name) {
        const parentSink = propSinkId(passedFrom, sourceFlow.name);
        tracePropOnComponent(
          builder,
          passedFrom,
          sourceFlow.name,
          parentSink,
          depth + 1
        );
        addChainEdge(builder, parentSink, sinkId, "prop_source", {
          propName,
          viaParent: passedFrom,
        });
      } else if (parentCallee) {
        const parentSymbol = builder.symbols.find(
          (item) => item.id === passedFrom
        );
        const parentFlowSources = builder.pool.filter(
          (edge) =>
            edge.type === "prop_source" &&
            edge.to === passedFrom &&
            edge.from === sourceId
        );

        if (parentFlowSources.length === 0 && parentSymbol) {
          tracePropOnComponent(
            builder,
            passedFrom,
            sourceFlow?.name ?? propName,
            propSinkId(passedFrom, sourceFlow?.name ?? propName),
            depth + 1
          );
        }
      }
    }
  }

  if (propSources.length === 0) {
    const passOnly = findPassesPropEdge(
      builder.pool,
      "",
      componentId,
      propName
    );

    for (const edge of builder.pool) {
      if (edge.type !== "passes_prop" || edge.to !== componentId) {
        continue;
      }

      const attributes = edge.metadata?.attributes;
      if (!Array.isArray(attributes)) {
        continue;
      }

      const match = attributes.find(
        (attr) =>
          String((attr as { name: string }).name).toLowerCase() ===
          propName.toLowerCase()
      );
      if (!match) {
        continue;
      }

      linkParentPass(
        builder,
        edge.from,
        componentId,
        sinkId,
        propName,
        edge.metadata?.line as number | undefined
      );
    }

    void passOnly;
  }
}

function pruneToSinkReachable(
  nodes: Map<string, TraceNode>,
  edges: Map<string, RawEdge>,
  sinkId: string
): { nodes: Map<string, TraceNode>; edges: Map<string, RawEdge> } {
  const incomingTo = new Map<string, string[]>();

  for (const edge of edges.values()) {
    const list = incomingTo.get(edge.to) ?? [];
    list.push(edge.from);
    incomingTo.set(edge.to, list);
  }

  const reachable = new Set<string>([sinkId]);
  const queue = [sinkId];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    for (const parent of incomingTo.get(current) ?? []) {
      if (!reachable.has(parent)) {
        reachable.add(parent);
        queue.push(parent);
      }
    }
  }

  const prunedNodes = new Map<string, TraceNode>();
  for (const id of reachable) {
    const node = nodes.get(id);
    if (node) {
      prunedNodes.set(id, node);
    }
  }

  const prunedEdges = new Map<string, RawEdge>();
  for (const [id, edge] of edges) {
    if (reachable.has(edge.from) && reachable.has(edge.to)) {
      prunedEdges.set(id, edge);
    }
  }

  return { edges: prunedEdges, nodes: prunedNodes };
}

export interface PropUpstreamChainResult {
  nodes: TraceNode[];
  edges: TraceEdge[];
  propSinkId: string;
  focusNodeId?: string;
}

export function buildPropUpstreamChain(
  db: TraceDatabase,
  componentId: string,
  propName: string,
  symbols: DbSymbol[],
  routes: RouteInfo[]
): PropUpstreamChainResult {
  const sinkId = propSinkId(componentId, propName);
  const component = symbols.find((item) => item.id === componentId);

  const ownerIds = new Set<string>([componentId]);
  for (const edge of getEdgesForSymbol(db, componentId)) {
    if (edge.type === "passes_prop" && edge.to === componentId) {
      ownerIds.add(edge.from);
    }
    if (edge.type === "prop_source" && edge.to === componentId) {
      const passedFrom = edge.metadata?.passedFrom as string | undefined;
      if (passedFrom) {
        ownerIds.add(passedFrom);
      }
    }
  }

  const pool = collectPoolForOwners(db, [...ownerIds]);

  const builder: ChainBuilder = {
    edges: new Map(),
    nodes: new Map(),
    pool,
    routes,
    symbols,
  };

  builder.nodes.set(sinkId, {
    id: sinkId,
    label: propName,
    metadata: {
      isPropSink: true,
      ownerComponentId: componentId,
      ownerLabel: component?.name,
    },
    traceable: false,
    type: "prop",
  });

  tracePropOnComponent(builder, componentId, propName, sinkId, 0);

  const pruned = pruneToSinkReachable(builder.nodes, builder.edges, sinkId);

  let focusNodeId: string | undefined;
  for (const [id, node] of pruned.nodes) {
    if (id === sinkId) {
      continue;
    }
    if (
      node.type === "hook" ||
      node.type === "service" ||
      node.type === "function"
    ) {
      focusNodeId = id;
      break;
    }
  }

  if (!focusNodeId) {
    for (const id of pruned.nodes.keys()) {
      if (id !== sinkId && !id.startsWith("step:")) {
        focusNodeId = id;
        break;
      }
    }
  }

  return {
    edges: [...pruned.edges.values()].map(makeTraceEdge),
    focusNodeId,
    nodes: [...pruned.nodes.values()],
    propSinkId: sinkId,
  };
}
