import { readFileSync } from "node:fs";
import path from "node:path";

import {
  buildCallChainLines,
  buildDeepCallChainForComponent,
  buildPropOriginLines,
  buildReceivedPropsLines,
  TRACE_EDGE_TYPES,
} from "@ai-trace/agent";
import {
  collectExpandedEdges,
  getEdgesForSymbol,
  loadGraph,
  loadRoutes,
  loadSymbols,
} from "@ai-trace/cache";
import type { DbSymbol, TraceDatabase } from "@ai-trace/cache";
import { collectRouteSubgraph } from "@ai-trace/graph";
import type { GraphEdge, RouteInfo, SymbolInfo } from "@ai-trace/types";

import { COMPONENT_GRAPH_EDGE_TYPES } from "../component-view";
import { formatTraceEdgeLabel } from "../edge-labels";
import type {
  ComponentChildRef,
  DataFlowGraphResponse,
  InspectorItem,
  ScopeItem,
  SearchResultItem,
  SourceSnippet,
  TraceEdge,
  TraceGraphResponse,
  TraceNode,
  TraceNodeBadge,
  TraceNodeType,
} from "../types";
import { buildPropUpstreamChain } from "./prop-upstream-chain";

const COMPONENT_EDGE_TYPES = COMPONENT_GRAPH_EDGE_TYPES;

const DATA_FLOW_EDGE_TYPES = new Set([
  "calls",
  "uses_hook",
  "prop_source",
  "sequence",
]);

const COMPONENT_EXPAND_DEPTH = 6;
const DATA_FLOW_EXPAND_DEPTH = 5;

function toSymbolInfo(symbol: DbSymbol): SymbolInfo {
  return {
    calls: symbol.calls ?? symbol.metadata.calls,
    endLine: symbol.endLine,
    executionSteps: symbol.executionSteps ?? symbol.metadata.executionSteps,
    filePath: symbol.filePath,
    hash: symbol.hash,
    id: symbol.id,
    name: symbol.name,
    passedProps: symbol.metadata.passedProps,
    props: symbol.props ?? symbol.metadata.props,
    renderSites: symbol.renderSites ?? symbol.metadata.renderSites,
    renders: symbol.renders ?? symbol.metadata.renders,
    signature: symbol.signature,
    startLine: symbol.startLine,
    type: symbol.type,
    usesHooks: symbol.usesHooks ?? symbol.metadata.usesHooks,
  };
}

function inferRouteSegmentType(
  filePath: string | undefined
): TraceNodeType | null {
  if (!filePath) {
    return null;
  }

  const base = path.basename(filePath);
  if (/^layout\.(tsx|ts|jsx|js)$/.test(base)) {
    return "layout";
  }
  if (/^page\.(tsx|ts|jsx|js)$/.test(base)) {
    return "page";
  }
  if (/^loading\.(tsx|ts|jsx|js)$/.test(base)) {
    return "loading";
  }
  if (/^error\.(tsx|ts|jsx|js)$/.test(base)) {
    return "error";
  }
  if (/^not-found\.(tsx|ts|jsx|js)$/.test(base)) {
    return "not_found";
  }

  return null;
}

function toTraceNode(
  symbol: DbSymbol,
  usedBy?: string[],
  extras?: TraceNode["metadata"],
  nodeType?: TraceNodeType
): TraceNode {
  const segmentType = inferRouteSegmentType(symbol.filePath);

  return {
    endLine: symbol.endLine,
    filePath: symbol.filePath,
    id: symbol.id,
    label: symbol.name,
    metadata: {
      calls: symbol.calls ?? symbol.metadata.calls,
      executionSteps: symbol.executionSteps ?? symbol.metadata.executionSteps,
      props: symbol.props ?? symbol.metadata.props,
      renders: symbol.renders ?? symbol.metadata.renders,
      usedBy,
      usesHooks: symbol.usesHooks ?? symbol.metadata.usesHooks,
      ...extras,
    },
    startLine: symbol.startLine,
    traceable: true,
    type: nodeType ?? segmentType ?? (symbol.type as TraceNodeType),
  };
}

function graphNodeFromId(
  id: string,
  symbols: DbSymbol[],
  routes: ReturnType<typeof loadRoutes>
): TraceNode | null {
  const segmentPrefixes: [string, TraceNodeType][] = [
    ["layout:", "layout"],
    ["page:", "page"],
    ["loading:", "loading"],
    ["error:", "error"],
    ["not_found:", "not_found"],
  ];

  for (const [prefix, type] of segmentPrefixes) {
    if (!id.startsWith(prefix)) {
      continue;
    }

    const filePath = id.slice(prefix.length);
    const symbol = symbols.find((item) => item.filePath === filePath);
    if (symbol) {
      return toTraceNode(symbol, undefined, undefined, type);
    }

    return {
      filePath,
      id,
      label: path.basename(filePath),
      traceable: true,
      type,
    };
  }

  const symbol = symbols.find((s) => s.id === id);
  if (symbol) {
    return toTraceNode(symbol);
  }

  if (id.startsWith("file:")) {
    const filePath = id.slice("file:".length);
    return {
      filePath,
      id,
      label: path.basename(filePath),
      traceable: false,
      type: "file",
    };
  }

  if (id.startsWith("builtin:")) {
    return {
      id,
      label: id.slice("builtin:".length),
      traceable: false,
      type: "builtin",
    };
  }

  if (id.startsWith("external:")) {
    return {
      id,
      label: id.slice("external:".length).replace("#", " · "),
      traceable: false,
      type: "external",
    };
  }

  const route = routes.find((r) => r.id === id);
  if (route) {
    return {
      filePath: route.pageFile,
      id: route.id,
      label: route.path,
      traceable: true,
      type: "route",
    };
  }

  return null;
}

export function getScopes(
  scope: string,
  scopesConfig?: Record<string, { type: string }>
): { defaultScope: string; items: ScopeItem[] } {
  if (scopesConfig && Object.keys(scopesConfig).length > 0) {
    return {
      defaultScope: scope,
      items: Object.entries(scopesConfig).map(([id, cfg]) => ({
        id,
        label: id,
        type: cfg.type as ScopeItem["type"],
      })),
    };
  }

  return {
    defaultScope: scope,
    items: [{ id: scope, label: scope, type: "workspace" }],
  };
}

export function searchTraceTargets(
  db: TraceDatabase,
  query: string,
  limit = 30
): SearchResultItem[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return [];
  }

  const symbols = loadSymbols(db);
  const routes = loadRoutes(db);
  const results: SearchResultItem[] = [];

  for (const symbol of symbols) {
    const haystack =
      `${symbol.name} ${symbol.filePath} ${symbol.type}`.toLowerCase();
    if (!haystack.includes(q)) {
      continue;
    }

    results.push({
      endLine: symbol.endLine,
      filePath: symbol.filePath,
      id: symbol.id,
      label: symbol.name,
      startLine: symbol.startLine,
      traceable: true,
      type: symbol.type,
    });
  }

  for (const route of routes) {
    if (!route.path.toLowerCase().includes(q)) {
      continue;
    }

    results.push({
      filePath: route.pageFile,
      id: route.id,
      label: route.path,
      traceable: true,
      type: "route",
    });
  }

  return results.slice(0, limit);
}

function readSourceSnippet(
  workspaceRoot: string,
  filePath: string,
  startLine: number,
  endLine: number
): SourceSnippet {
  const absolutePath = path.resolve(workspaceRoot, filePath);
  const resolvedRoot = path.resolve(workspaceRoot);

  if (
    !absolutePath.startsWith(resolvedRoot + path.sep) &&
    absolutePath !== resolvedRoot
  ) {
    throw new Error("Path traversal denied");
  }

  const content = readFileSync(absolutePath, "utf-8");
  const lines = content.split("\n");
  const code = lines.slice(startLine - 1, endLine).join("\n");

  return { code, endLine, filePath, startLine };
}

function buildParentComponentNames(
  symbolId: string,
  symbols: DbSymbol[],
  edges: ReturnType<typeof getEdgesForSymbol>
): string[] {
  const parents: string[] = [];

  for (const edge of edges) {
    if (edge.to !== symbolId) {
      continue;
    }

    if (
      edge.type !== "renders" &&
      edge.type !== "passes_prop" &&
      edge.type !== "routes_to" &&
      edge.type !== "wraps" &&
      edge.type !== "shows_loading" &&
      edge.type !== "shows_error" &&
      edge.type !== "shows_not_found"
    ) {
      continue;
    }

    const parent = symbols.find((s) => s.id === edge.from);
    if (parent) {
      parents.push(parent.name);
    } else if (edge.from.startsWith("route:")) {
      const route = edge.from;
      parents.push(route.slice("route:".length) || edge.from);
    }
  }

  return [...new Set(parents)];
}

function buildUsedBy(
  symbolId: string,
  symbols: DbSymbol[],
  edges: ReturnType<typeof getEdgesForSymbol>
): string[] {
  const usedBy: string[] = [];

  for (const edge of edges) {
    if (edge.to !== symbolId || edge.type === "renders") {
      continue;
    }

    const parent = symbols.find((s) => s.id === edge.from);
    if (parent) {
      usedBy.push(parent.name);
    }
  }

  return [...new Set(usedBy)];
}

const GRAPH_EXPAND_DEPTH = 6;

function expandTraceGraph(
  db: TraceDatabase,
  centerId: string
): ReturnType<typeof collectExpandedEdges> {
  return collectExpandedEdges(db, centerId, {
    depth: GRAPH_EXPAND_DEPTH,
    edgeTypes: TRACE_EDGE_TYPES,
  });
}

function buildTraceMetadata(
  symbol: DbSymbol,
  allSymbols: DbSymbol[],
  edges: ReturnType<typeof collectExpandedEdges>
): TraceNode["metadata"] {
  const symbolInfos = allSymbols.map(toSymbolInfo);
  const asSymbol = toSymbolInfo(symbol);

  if (symbol.type === "component") {
    return {
      callChain: buildDeepCallChainForComponent(asSymbol, symbolInfos, edges),
      propOrigins: buildPropOriginLines(asSymbol, symbolInfos, edges),
      propsReceived: buildReceivedPropsLines(symbol.id, symbolInfos, edges),
    };
  }

  if (symbol.type === "hook") {
    return {
      callChain: buildCallChainLines(symbol.id, symbolInfos, edges),
    };
  }

  return undefined;
}

export function getTraceNode(
  db: TraceDatabase,
  workspaceRoot: string,
  scope: string,
  nodeId: string
): TraceGraphResponse {
  const symbols = loadSymbols(db);
  const routes = loadRoutes(db);
  const symbol = symbols.find((s) => s.id === nodeId);

  let centerNode: TraceNode;

  const edges = symbol
    ? expandTraceGraph(db, symbol.id)
    : getEdgesForSymbol(db, nodeId).filter((edge) =>
        TRACE_EDGE_TYPES.has(edge.type)
      );

  if (symbol) {
    const localEdges = getEdgesForSymbol(db, symbol.id);
    const usedBy = buildUsedBy(symbol.id, symbols, localEdges);
    const traceMetadata = buildTraceMetadata(symbol, symbols, edges);
    centerNode = toTraceNode(symbol, usedBy, traceMetadata);
  } else {
    const route = routes.find((r) => r.id === nodeId);
    if (!route) {
      throw new Error(`Node not found: ${nodeId}`);
    }

    centerNode = {
      filePath: route.pageFile,
      id: route.id,
      label: route.path,
      traceable: true,
      type: "route",
    };
  }

  const relatedIds = new Set<string>([nodeId]);
  for (const edge of edges) {
    relatedIds.add(edge.from);
    relatedIds.add(edge.to);
  }

  const nodes: TraceNode[] = [];
  for (const id of relatedIds) {
    const node = graphNodeFromId(id, symbols, routes);
    if (node) {
      nodes.push(node);
    }
  }

  const traceEdges: TraceEdge[] = mapToTraceEdges(edges);

  let source: SourceSnippet | undefined;
  if (centerNode.filePath && centerNode.startLine && centerNode.endLine) {
    source = readSourceSnippet(
      workspaceRoot,
      centerNode.filePath,
      centerNode.startLine,
      centerNode.endLine
    );
  }

  return {
    centerNode,
    edges: traceEdges,
    nodes,
    scope,
    source,
    view: "full",
  };
}

export function getSourceSnippet(
  workspaceRoot: string,
  filePath: string,
  startLine: number,
  endLine: number
): SourceSnippet {
  return readSourceSnippet(workspaceRoot, filePath, startLine, endLine);
}

function formatPassedProps(
  metadata: Record<string, unknown> | undefined
): string | undefined {
  const attributes = metadata?.attributes;
  if (!Array.isArray(attributes) || attributes.length === 0) {
    return metadata?.props as string | undefined;
  }

  return attributes
    .map((attr) => {
      const item = attr as { name: string; value: string };
      return `${item.name}=${item.value}`;
    })
    .join(", ");
}

function buildChildrenRefs(
  centerId: string,
  symbols: DbSymbol[],
  edges: ReturnType<typeof collectExpandedEdges>
): ComponentChildRef[] {
  const byChildId = new Map<string, ComponentChildRef>();

  for (const edge of edges) {
    if (
      edge.from !== centerId ||
      (edge.type !== "renders" &&
        edge.type !== "passes_prop" &&
        edge.type !== "wraps" &&
        edge.type !== "shows_loading" &&
        edge.type !== "shows_error" &&
        edge.type !== "shows_not_found")
    ) {
      continue;
    }

    const child = symbols.find((s) => s.id === edge.to);
    if (!child || child.type !== "component") {
      continue;
    }

    const props = formatPassedProps(edge.metadata);
    const existing = byChildId.get(edge.to);

    if (!existing) {
      byChildId.set(edge.to, {
        edgeType: edge.type,
        filePath: child.filePath,
        id: edge.to,
        label: child.name,
        props,
      });
      continue;
    }

    if (edge.type === "passes_prop" && props) {
      existing.props = props;
      existing.edgeType = "passes_prop";
    }
  }

  return [...byChildId.values()].toSorted((a, b) =>
    a.label.localeCompare(b.label)
  );
}

function dedupeCompositionEdges(
  edges: ReturnType<typeof collectExpandedEdges>
): ReturnType<typeof collectExpandedEdges> {
  const byPair = new Map<string, (typeof edges)[number]>();

  for (const edge of edges) {
    const key = `${edge.from}->${edge.to}`;
    const existing = byPair.get(key);

    if (!existing || edge.type === "passes_prop") {
      byPair.set(key, edge);
    }
  }

  return [...byPair.values()];
}

function mapToTraceEdges(
  edges: ReturnType<typeof collectExpandedEdges>
): TraceEdge[] {
  return edges.map((edge) => ({
    from: edge.from,
    id: edge.id,
    label: formatTraceEdgeLabel({
      metadata: edge.metadata,
      type: edge.type,
    }),
    metadata: edge.metadata as TraceEdge["metadata"],
    to: edge.to,
    type: edge.type,
  }));
}

function buildInspectorItems(
  symbol: DbSymbol,
  symbols: DbSymbol[],
  metadataEdges: ReturnType<typeof collectExpandedEdges>,
  children: ComponentChildRef[],
  usedBy: string[] | undefined
): InspectorItem[] {
  const items: InspectorItem[] = [];
  const symbolInfo = toSymbolInfo(symbol);

  for (const prop of symbol.props ?? symbol.metadata.props ?? []) {
    items.push({
      endLine: symbol.endLine,
      filePath: symbol.filePath,
      focus: prop,
      focusKind: "prop",
      id: `declared:${prop}`,
      kind: "declared_prop",
      label: prop,
      line: symbol.startLine,
      startLine: symbol.startLine,
    });
  }

  for (const edge of metadataEdges) {
    if (edge.to !== symbol.id || edge.type !== "passes_prop") {
      continue;
    }

    const parent = symbols.find((s) => s.id === edge.from);
    const attributes = Array.isArray(edge.metadata?.attributes)
      ? (edge.metadata.attributes as { name: string; value: string }[])
      : [];

    for (const attr of attributes) {
      items.push({
        endLine: parent?.endLine,
        filePath: parent?.filePath ?? symbol.filePath,
        focus: attr.name,
        focusKind: "prop",
        id: `received:${attr.name}`,
        kind: "received_prop",
        label: attr.name,
        line: edge.metadata?.line as number | undefined,
        startLine: parent?.startLine,
        subtitle: `${attr.value} from ${parent?.name ?? edge.from}`,
      });
    }
  }

  for (const edge of metadataEdges) {
    if (edge.to !== symbol.id && edge.metadata?.passedFrom !== symbol.id) {
      continue;
    }

    if (edge.type !== "prop_source") {
      continue;
    }

    const propName = edge.metadata?.propName as string | undefined;
    const source = symbols.find((s) => s.id === edge.from);
    const child = symbols.find((s) => s.id === edge.to);

    items.push({
      endLine: symbol.endLine,
      filePath: symbol.filePath,
      focus: propName,
      focusKind: "prop",
      id: `origin:${propName}:${edge.id}`,
      kind: "prop_origin",
      label: propName ?? "prop",
      line: edge.metadata?.line as number | undefined,
      startLine: symbol.startLine,
      subtitle: `${source?.name ?? edge.from} → ${child?.name ?? edge.to}`,
    });
  }

  for (const child of children) {
    if (!child.props) {
      continue;
    }

    for (const part of child.props.split(",").map((s) => s.trim())) {
      const [name] = part.split("=");
      if (!name) {
        continue;
      }

      items.push({
        focus: name.trim(),
        focusKind: "prop",
        id: `passed:${child.id}:${name}`,
        kind: "passed_prop",
        label: name.trim(),
        subtitle: `→ ${child.label}: ${part}`,
        targetNodeId: child.id,
      });
    }
  }

  for (const parentName of usedBy ?? []) {
    const parent = symbols.find(
      (s) => s.name === parentName && s.type === "component"
    );

    items.push({
      id: `parent:${parentName}`,
      kind: "parent",
      label: parentName,
      subtitle: "Parent component",
      targetNodeId: parent?.id,
    });
  }

  for (const step of symbol.executionSteps ??
    symbol.metadata.executionSteps ??
    []) {
    if (step.kind === "hook") {
      items.push({
        endLine: symbol.endLine,
        filePath: symbol.filePath,
        focus: step.label,
        focusKind: "hook",
        id: `hook:${step.order}:${step.label}`,
        kind: "hook",
        label: step.label,
        line: step.line,
        startLine: symbol.startLine,
        subtitle: step.expression,
      });
    } else if (step.kind === "call") {
      items.push({
        endLine: symbol.endLine,
        filePath: symbol.filePath,
        focus: step.label,
        focusKind: "call",
        id: `call:${step.order}:${step.label}`,
        kind: "call",
        label: step.label,
        line: step.line,
        startLine: symbol.startLine,
        subtitle: step.expression,
      });
    }

    items.push({
      endLine: symbol.endLine,
      filePath: symbol.filePath,
      focus: step.label,
      focusKind: "execution",
      id: `exec:${step.order}`,
      kind: "execution",
      label: `${step.kind}: ${step.label}`,
      line: step.line,
      startLine: symbol.startLine,
      subtitle: step.expression,
    });
  }

  for (const hookName of symbol.usesHooks ?? symbol.metadata.usesHooks ?? []) {
    if (items.some((item) => item.kind === "hook" && item.label === hookName)) {
      continue;
    }

    items.push({
      endLine: symbol.endLine,
      filePath: symbol.filePath,
      focus: hookName,
      focusKind: "hook",
      id: `hook-name:${hookName}`,
      kind: "hook",
      label: hookName,
      startLine: symbol.startLine,
    });
  }

  for (const prop of symbol.props ?? symbol.metadata.props ?? []) {
    if (items.some((item) => item.kind === "variable" && item.label === prop)) {
      continue;
    }

    items.push({
      endLine: symbol.endLine,
      filePath: symbol.filePath,
      focus: prop,
      focusKind: "prop",
      id: `var:prop:${prop}`,
      kind: "variable",
      label: prop,
      startLine: symbol.startLine,
      subtitle: "Component prop",
    });
  }

  const callChain = buildDeepCallChainForComponent(
    symbolInfo,
    symbols.map(toSymbolInfo),
    metadataEdges
  );

  for (const line of callChain) {
    const match = line.match(/^(\S+)/);
    const name = match?.[1];
    if (
      !name ||
      items.some((item) => item.label === name && item.kind === "variable")
    ) {
      continue;
    }

    items.push({
      focus: name,
      focusKind: "call",
      id: `var:chain:${name}`,
      kind: "variable",
      label: name,
      subtitle: line,
    });
  }

  return items;
}

type RawEdge = ReturnType<typeof collectExpandedEdges>[number];

function edgeInComponentScope(edge: RawEdge, centerId: string): boolean {
  return edge.from === centerId || edge.metadata?.passedFrom === centerId;
}

function edgeMatchesDataFocus(
  edge: RawEdge,
  focus: string,
  focusKind?: InspectorItem["focusKind"]
): boolean {
  const focusLower = focus.toLowerCase();
  const callee = String(edge.metadata?.callee ?? "").toLowerCase();
  const expression = String(edge.metadata?.expression ?? "").toLowerCase();
  const propName = String(edge.metadata?.propName ?? "").toLowerCase();

  if (focusKind === "prop") {
    if (edge.type === "prop_source") {
      return propName === focusLower;
    }
    return callee.includes(focusLower) || expression.includes(focusLower);
  }

  if (focusKind === "hook") {
    return (
      edge.type === "uses_hook" &&
      (callee.includes(focusLower) ||
        edge.to.toLowerCase().includes(focusLower))
    );
  }

  if (focusKind === "call" || focusKind === "execution") {
    return (
      (edge.type === "calls" || edge.type === "sequence") &&
      (callee.includes(focusLower) || expression.includes(focusLower))
    );
  }

  return (
    callee.includes(focusLower) ||
    expression.includes(focusLower) ||
    propName === focusLower
  );
}

/** Usage: data-flow edges scoped to the owning component + focus. */
function collectUsageEdges(
  edges: RawEdge[],
  centerId: string,
  focus: string,
  focusKind?: InspectorItem["focusKind"]
): RawEdge[] {
  const usage = new Map<string, RawEdge>();
  const focusLower = focus.toLowerCase();

  for (const edge of edges) {
    if (!DATA_FLOW_EDGE_TYPES.has(edge.type)) {
      continue;
    }

    if (!edgeInComponentScope(edge, centerId)) {
      continue;
    }

    if (focusKind === "prop") {
      if (edge.type === "prop_source") {
        if (
          String(edge.metadata?.propName ?? "").toLowerCase() === focusLower
        ) {
          usage.set(edge.id, edge);
        }
        continue;
      }

      if (
        edge.from === centerId &&
        (edge.type === "calls" ||
          edge.type === "sequence" ||
          edge.type === "uses_hook")
      ) {
        usage.set(edge.id, edge);
      }
      continue;
    }

    if (
      edge.from === centerId &&
      edgeMatchesDataFocus(edge, focus, focusKind)
    ) {
      usage.set(edge.id, edge);
    }
  }

  return [...usage.values()];
}

/** Upstream: walk incoming data-flow edges to the root source. */
function collectUpstreamEdges(
  edges: RawEdge[],
  seedIds: Iterable<string>,
  centerId: string,
  maxHops = 14
): RawEdge[] {
  const included = new Map<string, RawEdge>();
  let frontier = new Set(
    [...seedIds].filter((id) => id !== centerId && id.length > 0)
  );

  for (let hop = 0; hop < maxHops && frontier.size > 0; hop += 1) {
    const next = new Set<string>();

    for (const edge of edges) {
      if (!DATA_FLOW_EDGE_TYPES.has(edge.type)) {
        continue;
      }

      if (!frontier.has(edge.to)) {
        continue;
      }

      included.set(edge.id, edge);

      if (edge.from !== centerId && !frontier.has(edge.from)) {
        next.add(edge.from);
      }
    }

    frontier = next;
  }

  return [...included.values()];
}

function buildFocusedDataFlowEdges(
  db: TraceDatabase,
  centerId: string,
  focus: string,
  focusKind?: InspectorItem["focusKind"]
): { edges: RawEdge[]; focusNodeId?: string } {
  const pool = dedupeRawEdges(
    collectExpandedEdges(db, centerId, {
      depth: DATA_FLOW_EXPAND_DEPTH,
      edgeTypes: DATA_FLOW_EDGE_TYPES,
    })
  );

  const usage = collectUsageEdges(pool, centerId, focus, focusKind);

  const upstreamSeeds = new Set<string>();
  for (const edge of usage) {
    if (edge.type === "prop_source") {
      upstreamSeeds.add(edge.from);
    }
    if (
      edge.type === "calls" ||
      edge.type === "sequence" ||
      edge.type === "uses_hook"
    ) {
      if (edge.from === centerId) {
        upstreamSeeds.add(edge.to);
      } else {
        upstreamSeeds.add(edge.from);
      }
    }
  }

  let expandedPool = [...pool];
  for (const seedId of upstreamSeeds) {
    expandedPool = dedupeRawEdges([
      ...expandedPool,
      ...collectExpandedEdges(db, seedId, {
        depth: DATA_FLOW_EXPAND_DEPTH,
        edgeTypes: DATA_FLOW_EDGE_TYPES,
      }),
    ]);
  }

  const upstream = collectUpstreamEdges(expandedPool, upstreamSeeds, centerId);

  const merged = new Map<string, RawEdge>();
  for (const edge of [...usage, ...upstream]) {
    merged.set(edge.id, edge);
  }

  const symbols = loadSymbols(db);
  let focusNodeId: string | undefined;

  for (const seedId of upstreamSeeds) {
    const sym = symbols.find((s) => s.id === seedId);
    if (sym && sym.type !== "component" && sym.type !== "route") {
      focusNodeId = seedId;
      break;
    }
  }

  return { edges: [...merged.values()], focusNodeId };
}

function dedupeRawEdges(
  edges: ReturnType<typeof collectExpandedEdges>
): ReturnType<typeof collectExpandedEdges> {
  const seen = new Set<string>();

  return edges.filter((edge) => {
    if (!DATA_FLOW_EDGE_TYPES.has(edge.type)) {
      return false;
    }

    const key = `${edge.from}->${edge.to}:${edge.type}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

export function getDataFlowTrace(
  db: TraceDatabase,
  nodeId: string,
  focus?: string,
  focusKind?: InspectorItem["focusKind"]
): DataFlowGraphResponse {
  const symbols = loadSymbols(db);
  const routes = loadRoutes(db);
  const symbol = symbols.find((s) => s.id === nodeId);

  if (!symbol) {
    throw new Error(`Node not found: ${nodeId}`);
  }

  if (!focus) {
    throw new Error("Data flow requires a focus (prop, hook, or variable)");
  }

  if (focusKind === "prop") {
    const chain = buildPropUpstreamChain(db, nodeId, focus, symbols, routes);

    return {
      centerNode: toTraceNode(symbol),
      edges: chain.edges,
      focusLabel: focus,
      focusNodeId: chain.propSinkId,
      nodes: chain.nodes,
      propSinkId: chain.propSinkId,
    };
  }

  const { edges: selected, focusNodeId } = buildFocusedDataFlowEdges(
    db,
    nodeId,
    focus,
    focusKind
  );

  const relatedIds = new Set<string>();
  for (const edge of selected) {
    relatedIds.add(edge.from);
    relatedIds.add(edge.to);
  }

  const nodes: TraceNode[] = [];
  for (const id of relatedIds) {
    const node = graphNodeFromId(id, symbols, routes);
    if (!node) {
      continue;
    }

    if (
      node.type === "route" ||
      node.type === "page" ||
      node.type === "layout"
    ) {
      continue;
    }

    nodes.push(node);
  }

  const nodeIds = new Set(nodes.map((node) => node.id));
  const traceEdges = mapToTraceEdges(
    selected.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to))
  );

  return {
    centerNode: toTraceNode(symbol),
    edges: traceEdges,
    focusLabel: focus,
    focusNodeId,
    nodes,
  };
}

function buildPassedToChildrenLines(children: ComponentChildRef[]): string[] {
  return children
    .filter((child) => child.props)
    .map((child) => `${child.label}: ${child.props}`);
}

function buildNodeBadge(
  symbol: DbSymbol,
  children: ComponentChildRef[]
): TraceNodeBadge {
  return {
    calls: symbol.calls?.length ?? symbol.metadata.calls?.length ?? 0,
    children: children.length,
    hooks: symbol.usesHooks?.length ?? symbol.metadata.usesHooks?.length ?? 0,
  };
}

function routesForComponent(
  symbol: DbSymbol,
  symbols: DbSymbol[],
  routes: RouteInfo[],
  localEdges: RawEdge[]
): RouteInfo[] {
  const consumerIds = new Set<string>();

  for (const edge of localEdges) {
    if (
      edge.to === symbol.id &&
      (edge.type === "renders" || edge.type === "passes_prop")
    ) {
      consumerIds.add(edge.from);
    }
  }

  const matched = new Map<string, RouteInfo>();

  for (const consumerId of consumerIds) {
    const consumer = symbols.find((item) => item.id === consumerId);
    if (!consumer) {
      continue;
    }

    for (const route of routes) {
      if (
        route.pageFile === consumer.filePath ||
        route.layoutFiles.includes(consumer.filePath) ||
        route.loadingFile === consumer.filePath ||
        route.errorFile === consumer.filePath ||
        route.notFoundFile === consumer.filePath
      ) {
        matched.set(route.id, route);
      }
    }
  }

  for (const edge of localEdges) {
    if (edge.to !== symbol.id || edge.type !== "routes_to") {
      continue;
    }

    const route = routes.find((item) => item.id === edge.from);
    if (route) {
      matched.set(route.id, route);
    }
  }

  return [...matched.values()];
}

/** Scope composition to route(s) that render this component — not the whole app layout tree. */
function collectComponentCompositionEdges(
  db: TraceDatabase,
  symbol: DbSymbol,
  symbols: DbSymbol[],
  routes: RouteInfo[]
): RawEdge[] {
  const graphEdges = loadGraph(db).edges;
  const symbolInfos = symbols.map(toSymbolInfo);
  const localEdges = getEdgesForSymbol(db, symbol.id);
  const matchedRoutes = routesForComponent(symbol, symbols, routes, localEdges);

  if (matchedRoutes.length > 0) {
    const edgeMap = new Map<string, RawEdge>();

    for (const route of matchedRoutes) {
      const subgraph = collectRouteSubgraph(
        route,
        routes,
        symbolInfos,
        graphEdges
      );

      for (const edge of subgraph.edges) {
        if (!COMPONENT_EDGE_TYPES.has(edge.type)) {
          continue;
        }

        edgeMap.set(edge.id, edge as RawEdge);
      }
    }

    return [...edgeMap.values()];
  }

  return collectDirectedCompositionEdges(symbol.id, graphEdges);
}

function collectDirectedCompositionEdges(
  centerId: string,
  edges: GraphEdge[]
): RawEdge[] {
  const compositionEdges = edges.filter((edge) =>
    COMPONENT_EDGE_TYPES.has(edge.type)
  );
  const collected = new Map<string, RawEdge>();
  const upstreamTypes = new Set([
    "renders",
    "passes_prop",
    "routes_to",
    "wraps",
    "shows_loading",
    "shows_error",
    "shows_not_found",
  ]);
  const downstreamTypes = new Set(["renders", "passes_prop"]);

  let frontier = [centerId];
  for (let level = 0; level < 4 && frontier.length > 0; level += 1) {
    const next: string[] = [];

    for (const nodeId of frontier) {
      for (const edge of compositionEdges) {
        if (edge.to !== nodeId || !upstreamTypes.has(edge.type)) {
          continue;
        }

        collected.set(edge.id, edge as RawEdge);
        next.push(edge.from);
      }
    }

    frontier = next;
  }

  frontier = [centerId];
  for (let level = 0; level < 2 && frontier.length > 0; level += 1) {
    const next: string[] = [];

    for (const nodeId of frontier) {
      for (const edge of compositionEdges) {
        if (edge.from !== nodeId || !downstreamTypes.has(edge.type)) {
          continue;
        }

        collected.set(edge.id, edge as RawEdge);
        next.push(edge.to);
      }
    }

    frontier = next;
  }

  return [...collected.values()];
}

export function getComponentTrace(
  db: TraceDatabase,
  workspaceRoot: string,
  scope: string,
  nodeId: string
): TraceGraphResponse {
  const symbols = loadSymbols(db);
  const routes = loadRoutes(db);
  const symbol = symbols.find((s) => s.id === nodeId);
  const route = routes.find((r) => r.id === nodeId);

  const metadataEdges = symbol
    ? collectExpandedEdges(db, symbol.id, {
        depth: COMPONENT_EXPAND_DEPTH,
        edgeTypes: TRACE_EDGE_TYPES,
      })
    : [];

  const compositionEdges = route
    ? collectRouteSubgraph(
        route,
        routes,
        symbols.map(toSymbolInfo),
        loadGraph(db).edges
      ).edges
    : symbol
      ? collectComponentCompositionEdges(db, symbol, symbols, routes)
      : collectExpandedEdges(db, nodeId, {
          depth: COMPONENT_EXPAND_DEPTH,
          edgeTypes: COMPONENT_EDGE_TYPES,
        });

  let centerNode: TraceNode;

  const dedupedComposition = symbol
    ? dedupeCompositionEdges(compositionEdges)
    : compositionEdges;

  if (symbol) {
    const localEdges = getEdgesForSymbol(db, symbol.id);
    const usedBy = buildParentComponentNames(symbol.id, symbols, localEdges);
    const traceMetadata = buildTraceMetadata(symbol, symbols, metadataEdges);
    const children = buildChildrenRefs(symbol.id, symbols, dedupedComposition);
    const inspectorItems = buildInspectorItems(
      symbol,
      symbols,
      metadataEdges,
      children,
      usedBy
    );

    centerNode = toTraceNode(symbol, usedBy, {
      ...traceMetadata,
      badge: buildNodeBadge(symbol, children),
      children,
      inspectorItems,
      passedToChildren: buildPassedToChildrenLines(children),
    });
  } else if (route) {
    const children = buildChildrenRefs(route.id, symbols, dedupedComposition);

    centerNode = {
      filePath: route.pageFile,
      id: route.id,
      label: route.path,
      metadata: { children },
      traceable: true,
      type: "route",
    };
  } else {
    throw new Error(`Node not found: ${nodeId}`);
  }

  const relatedIds = new Set<string>([nodeId]);

  for (const edge of dedupedComposition) {
    relatedIds.add(edge.from);
    relatedIds.add(edge.to);
  }

  const nodes: TraceNode[] = [];
  for (const id of relatedIds) {
    const node = graphNodeFromId(id, symbols, routes);
    if (!node) {
      continue;
    }

    const compositionNodeTypes = new Set([
      "component",
      "route",
      "layout",
      "page",
      "loading",
      "error",
      "not_found",
    ]);

    if (!compositionNodeTypes.has(node.type)) {
      continue;
    }

    const dbSymbol = symbols.find((s) => s.id === id);
    if (dbSymbol) {
      const children = buildChildrenRefs(id, symbols, dedupedComposition);
      nodes.push(
        toTraceNode(
          dbSymbol,
          undefined,
          {
            badge: buildNodeBadge(dbSymbol, children),
            children,
            renders: dbSymbol.renders ?? dbSymbol.metadata.renders,
          },
          node.type === "component" ? undefined : node.type
        )
      );
      continue;
    }

    nodes.push(node);
  }

  const nodeIds = new Set(nodes.map((node) => node.id));

  const traceEdges: TraceEdge[] = mapToTraceEdges(
    dedupedComposition.filter(
      (edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to)
    )
  );

  let source: SourceSnippet | undefined;
  if (centerNode.filePath && centerNode.startLine && centerNode.endLine) {
    source = readSourceSnippet(
      workspaceRoot,
      centerNode.filePath,
      centerNode.startLine,
      centerNode.endLine
    );
  }

  return {
    centerNode,
    edges: traceEdges,
    nodes,
    scope,
    source,
    view: "component",
  };
}
