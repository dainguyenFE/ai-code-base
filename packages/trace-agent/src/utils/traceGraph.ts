import { isPageFile } from "@ai-trace/graph";
import type {
  CodeGraph,
  DataFlowNode,
  RouteInfo,
  SymbolInfo,
} from "@ai-trace/types";

export const DEFAULT_RENDER_DEPTH = 3;
export const DEFAULT_USAGE_DEPTH = 6;

export function formatLines(symbol: {
  startLine: number;
  endLine: number;
}): string {
  return `${symbol.startLine}-${symbol.endLine}`;
}

export function formatSymbolRef(symbol: SymbolInfo): string {
  return `${symbol.name} (${symbol.filePath}:${formatLines(symbol)})`;
}

export function resolveSymbol(
  symbols: SymbolInfo[],
  id: string
): SymbolInfo | undefined {
  return symbols.find((symbol) => symbol.id === id);
}

export function duplicateSymbolWarning(
  name: string,
  matches: SymbolInfo[]
): string | null {
  if (matches.length <= 1) {
    return null;
  }

  const others = matches
    .slice(1)
    .map((symbol) => `${symbol.filePath}:${formatLines(symbol)}`)
    .join(", ");

  return `Multiple "${name}" symbols (${matches.length}) — using ${matches[0].filePath}; also: ${others}`;
}

export function describeBoundary(
  flags: {
    isClientComponent: boolean;
    isServerComponent: boolean;
  } | null,
  options?: { usesHooks?: boolean; symbolType?: SymbolInfo["type"] }
): string {
  if (options?.symbolType === "hook") {
    return "boundary: hook module (imported by client components)";
  }

  if (!flags) {
    return "boundary: unknown (re-index or open source)";
  }
  if (flags.isClientComponent) {
    return 'boundary: client component ("use client")';
  }
  if (flags.isServerComponent) {
    return 'boundary: server module ("use server")';
  }
  if (options?.usesHooks) {
    return 'boundary: client component (uses hooks; "use client" not detected in file)';
  }
  return "boundary: server component (default RSC)";
}

export function getInboundRenderers(
  symbolId: string,
  symbols: SymbolInfo[],
  edges: CodeGraph["edges"]
): SymbolInfo[] {
  return edges
    .filter((edge) => edge.to === symbolId && edge.type === "renders")
    .map((edge) => resolveSymbol(symbols, edge.from))
    .filter((symbol): symbol is SymbolInfo => Boolean(symbol));
}

export function getOutboundRenders(
  symbolId: string,
  symbols: SymbolInfo[],
  edges: CodeGraph["edges"]
): SymbolInfo[] {
  return edges
    .filter((edge) => edge.from === symbolId && edge.type === "renders")
    .map((edge) => resolveSymbol(symbols, edge.to))
    .filter((symbol): symbol is SymbolInfo => Boolean(symbol));
}

export function getDirectHooks(
  symbolId: string,
  symbols: SymbolInfo[],
  edges: CodeGraph["edges"]
): SymbolInfo[] {
  return edges
    .filter((edge) => edge.from === symbolId && edge.type === "uses_hook")
    .map((edge) => resolveSymbol(symbols, edge.to))
    .filter((symbol): symbol is SymbolInfo => Boolean(symbol));
}

export function buildRenderTreeLines(
  rootId: string,
  symbols: SymbolInfo[],
  edges: CodeGraph["edges"],
  maxDepth = DEFAULT_RENDER_DEPTH
): string[] {
  const lines: string[] = [];

  function walk(fromId: string, depth: number, prefix: string): void {
    if (depth > maxDepth) {
      return;
    }

    const childEdges = edges.filter(
      (edge) => edge.from === fromId && edge.type === "renders"
    );

    for (const [index, edge] of childEdges.entries()) {
      const child = resolveSymbol(symbols, edge.to);
      const isLast = index === childEdges.length - 1;
      const branch = isLast ? "└── " : "├── ";
      const label = child ? formatSymbolRef(child) : edge.to;
      lines.push(`${prefix}${branch}${label}`);

      if (child && depth < maxDepth) {
        walk(child.id, depth + 1, `${prefix}${isLast ? "    " : "│   "}`);
      }
    }
  }

  walk(rootId, 1, "");
  return lines;
}

export function buildHookChainLines(
  hook: SymbolInfo,
  symbols: SymbolInfo[],
  depth = 2
): string[] {
  const lines = [formatSymbolRef(hook)];
  const calls = hook.calls ?? [];
  const innerHooks = hook.usesHooks ?? [];

  if (calls.length > 0) {
    lines.push(`  calls: ${calls.join(", ")}`);
  }

  for (const hookName of innerHooks) {
    const inner = symbols.find(
      (symbol) => symbol.name === hookName && symbol.type === "hook"
    );
    lines.push(`  uses hook: ${inner ? formatSymbolRef(inner) : hookName}`);

    if (depth > 1 && inner) {
      const nestedCalls = inner.calls ?? [];
      if (nestedCalls.length > 0) {
        lines.push(`    calls: ${nestedCalls.join(", ")}`);
      }
    }
  }

  return lines;
}

export function buildRouteMap(routes: RouteInfo[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const route of routes) {
    if (route.pageFile) {
      map.set(route.pageFile, route.path);
    }
  }
  return map;
}

export function routesTouchingFile(
  filePath: string,
  routes: RouteInfo[]
): RouteInfo[] {
  return routes.filter(
    (route) =>
      route.pageFile === filePath ||
      route.layoutFiles.includes(filePath) ||
      route.loadingFile === filePath ||
      route.errorFile === filePath ||
      route.notFoundFile === filePath ||
      route.routeHandlerFile === filePath
  );
}

export interface UsageChain {
  directConsumers: SymbolInfo[];
  transitiveChains: string[];
  routesAffected: string[];
  lines: string[];
}

export function buildUsageChain(
  symbolId: string,
  symbols: SymbolInfo[],
  edges: CodeGraph["edges"],
  routes: RouteInfo[],
  maxDepth = DEFAULT_USAGE_DEPTH
): UsageChain {
  const directConsumers = getInboundRenderers(symbolId, symbols, edges);
  const routePaths = new Set<string>();
  const transitiveChains: string[] = [];
  const lines: string[] = [];

  for (const edge of edges.filter(
    (item) => item.to === symbolId && item.type === "routes_to"
  )) {
    const route = routes.find((item) => item.id === edge.from);
    if (route) {
      routePaths.add(route.path);
    }
  }

  if (directConsumers.length === 0) {
    lines.push("direct consumers: none");
  } else {
    lines.push("direct consumers:");
    for (const consumer of directConsumers) {
      lines.push(`  - ${formatSymbolRef(consumer)}`);
      const consumerRoutes = routesTouchingFile(consumer.filePath, routes);
      for (const route of consumerRoutes) {
        routePaths.add(route.path);
        if (route.pageFile === consumer.filePath) {
          lines.push(`    └─ route: ${route.path} (page)`);
        } else {
          lines.push(`    └─ route: ${route.path} (layout/segment file)`);
        }
      }
    }
  }

  const visited = new Set<string>();
  const queue: { id: string; chain: string[]; depth: number }[] =
    directConsumers.map((consumer) => ({
      chain: [consumer.name],
      depth: 1,
      id: consumer.id,
    }));

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current.id) || current.depth > maxDepth) {
      continue;
    }
    visited.add(current.id);

    const symbol = resolveSymbol(symbols, current.id);
    if (!symbol) {
      continue;
    }

    if (isPageFile(symbol.filePath)) {
      const pageRoute = routes.find(
        (route) => route.pageFile === symbol.filePath
      );
      if (pageRoute) {
        routePaths.add(pageRoute.path);
        if (current.depth > 1) {
          const chain = [...current.chain, `route ${pageRoute.path}`].join(
            " → "
          );
          transitiveChains.push(chain);
          lines.push(`transitive: ${chain}`);
        }
      }
    }

    for (const parent of getInboundRenderers(current.id, symbols, edges)) {
      if (visited.has(parent.id)) {
        continue;
      }
      queue.push({
        chain: [...current.chain, parent.name],
        depth: current.depth + 1,
        id: parent.id,
      });
    }
  }

  const routesAffected = [...routePaths].toSorted();
  if (routesAffected.length > 0) {
    lines.push(`routes affected: ${routesAffected.join(", ")}`);
  } else {
    lines.push("routes affected: none detected");
  }

  return {
    directConsumers,
    lines,
    routesAffected,
    transitiveChains,
  };
}

function collectSubtreeSymbolIds(
  rootId: string,
  edges: CodeGraph["edges"],
  visited = new Set<string>()
): string[] {
  if (visited.has(rootId)) {
    return [];
  }
  visited.add(rootId);

  const childIds = edges
    .filter((edge) => edge.from === rootId && edge.type === "renders")
    .map((edge) => edge.to);

  return [
    rootId,
    ...childIds.flatMap((childId) =>
      collectSubtreeSymbolIds(childId, edges, visited)
    ),
  ];
}

export function buildPassedPropsLines(
  symbolId: string,
  symbols: SymbolInfo[],
  edges: CodeGraph["edges"]
): string[] {
  return edges
    .filter((edge) => edge.from === symbolId && edge.type === "passes_prop")
    .map((edge) => {
      const child = resolveSymbol(symbols, edge.to);
      const props =
        (edge.metadata?.props as string | undefined) ??
        (Array.isArray(edge.metadata?.attributes)
          ? (edge.metadata.attributes as { name: string; value: string }[])
              .map((attr) => `${attr.name}=${attr.value}`)
              .join(", ")
          : "unknown");

      return child ? `${child.name} ← ${props}` : `${edge.to} ← ${props}`;
    });
}

export function buildPassedPropsLinesInSubtree(
  rootId: string,
  symbols: SymbolInfo[],
  edges: CodeGraph["edges"]
): string[] {
  const lines: string[] = [];

  for (const id of collectSubtreeSymbolIds(rootId, edges)) {
    lines.push(...buildPassedPropsLines(id, symbols, edges));
  }

  return lines;
}

export function buildDynamicImportLines(
  symbolId: string,
  symbols: SymbolInfo[],
  edges: CodeGraph["edges"]
): string[] {
  return edges
    .filter((edge) => edge.from === symbolId && edge.type === "dynamic_imports")
    .map((edge) => {
      const target = resolveSymbol(symbols, edge.to);
      const moduleSpecifier = edge.metadata?.moduleSpecifier as
        | string
        | undefined;
      const kind = edge.metadata?.kind as string | undefined;
      const resolvedFile = edge.metadata?.resolvedFile as string | undefined;
      const line = edge.metadata?.line as number | undefined;

      const targetLabel = target
        ? formatSymbolRef(target)
        : ((edge.metadata?.targetComponent as string | undefined) ??
          resolvedFile ??
          edge.to);

      return `${kind ?? "dynamic"}(${moduleSpecifier ?? "?"}) line ${line ?? "?"} → ${targetLabel}`;
    });
}

export function buildDynamicImportLinesInSubtree(
  rootId: string,
  symbols: SymbolInfo[],
  edges: CodeGraph["edges"]
): string[] {
  const lines: string[] = [];

  for (const id of collectSubtreeSymbolIds(rootId, edges)) {
    lines.push(...buildDynamicImportLines(id, symbols, edges));
  }

  return lines;
}

export function collectRelatedFiles(
  symbol: SymbolInfo,
  symbols: SymbolInfo[],
  edges: CodeGraph["edges"],
  routes: RouteInfo[],
  usage: UsageChain
): string[] {
  const files = new Set<string>([symbol.filePath]);

  for (const consumer of usage.directConsumers) {
    files.add(consumer.filePath);
  }

  for (const hook of getDirectHooks(symbol.id, symbols, edges)) {
    files.add(hook.filePath);
  }

  for (const child of getOutboundRenders(symbol.id, symbols, edges)) {
    files.add(child.filePath);
  }

  for (const routePath of usage.routesAffected) {
    const route = routes.find((item) => item.path === routePath);
    if (!route) {
      continue;
    }
    if (route.pageFile) {
      files.add(route.pageFile);
    }
    for (const layout of route.layoutFiles) {
      files.add(layout);
    }
  }

  return [...files].toSorted();
}

export const TRACE_EDGE_TYPES = new Set([
  "routes_to",
  "wraps",
  "shows_loading",
  "shows_error",
  "shows_not_found",
  "renders",
  "uses_hook",
  "calls",
  "passes_prop",
  "prop_source",
  "sequence",
]);

export function formatDataFlowSummary(flow: DataFlowNode): string {
  if (flow.kind === "call" || flow.kind === "hook_call") {
    return flow.expression;
  }

  if (flow.children?.length === 1) {
    const child = flow.children[0];
    if (child.kind === "call" || child.kind === "hook_call") {
      return child.expression;
    }
    return formatDataFlowSummary(child);
  }

  return flow.expression;
}

export function formatDataFlowLines(flow: DataFlowNode, indent = 1): string[] {
  const prefix = "  ".repeat(indent);
  const kindLabel =
    flow.kind === "hook_call"
      ? "hook"
      : flow.kind === "call"
        ? "call"
        : flow.kind;
  const lines = [`${prefix}${flow.expression} [${kindLabel}:L${flow.line}]`];

  for (const child of flow.children ?? []) {
    lines.push(...formatDataFlowLines(child, indent + 1));
  }

  return lines;
}

function formatCallTarget(
  targetId: string,
  symbols: SymbolInfo[],
  metadata?: Record<string, unknown>
): string {
  if (targetId.startsWith("builtin:")) {
    return `${targetId.slice("builtin:".length)} [builtin]`;
  }

  if (targetId.startsWith("external:")) {
    const moduleSpecifier = metadata?.moduleSpecifier as string | undefined;
    const callee = metadata?.callee as string | undefined;
    const label = callee ?? targetId.slice("external:".length);
    return moduleSpecifier
      ? `${label} [external: ${moduleSpecifier}]`
      : `${label} [external]`;
  }

  const symbol = resolveSymbol(symbols, targetId);
  return symbol ? formatSymbolRef(symbol) : targetId;
}

export function buildReceivedPropsLines(
  symbolId: string,
  symbols: SymbolInfo[],
  edges: CodeGraph["edges"]
): string[] {
  const declared = resolveSymbol(symbols, symbolId)?.props ?? [];

  return edges
    .filter((edge) => edge.to === symbolId && edge.type === "passes_prop")
    .flatMap((edge) => {
      const parent = resolveSymbol(symbols, edge.from);
      const attributes = Array.isArray(edge.metadata?.attributes)
        ? (edge.metadata.attributes as { name: string; value: string }[])
        : [];

      return attributes.map((attr) => {
        const declaredNote = declared.includes(attr.name)
          ? "declared"
          : "not in destructured props";
        const parentLabel = parent
          ? `${parent.name} (${parent.filePath}:${formatLines(parent)})`
          : edge.from;

        return `${attr.name} ← ${attr.value} from ${parentLabel} (${declaredNote})`;
      });
    });
}

export function buildPropOriginLines(
  symbol: SymbolInfo,
  symbols: SymbolInfo[],
  edges: CodeGraph["edges"]
): string[] {
  const lines: string[] = [];
  const propSourceEdges = edges.filter(
    (edge) => edge.to === symbol.id && edge.type === "prop_source"
  );

  for (const edge of propSourceEdges) {
    const propName = edge.metadata?.propName as string | undefined;
    const jsxValue = edge.metadata?.jsxValue as string | undefined;
    const sourceFlow = edge.metadata?.sourceFlow as DataFlowNode | undefined;
    const passedFromId = edge.metadata?.passedFrom as string | undefined;
    const parent = passedFromId
      ? resolveSymbol(symbols, passedFromId)
      : undefined;
    const sourceLabel = formatCallTarget(edge.from, symbols, edge.metadata);
    const flowSummary = sourceFlow
      ? formatDataFlowSummary(sourceFlow)
      : (jsxValue ?? "?");

    const parentLabel = parent
      ? `${parent.name} (${parent.filePath}:${formatLines(parent)})`
      : (passedFromId ?? "unknown parent");

    lines.push(
      `  ${propName ?? "?"} ← ${flowSummary} from ${sourceLabel} via ${parentLabel}`
    );

    if (sourceFlow) {
      lines.push(...formatDataFlowLines(sourceFlow, 2));
    }
  }

  if (lines.length > 0) {
    return lines;
  }

  for (const edge of edges.filter(
    (item) => item.to === symbol.id && item.type === "passes_prop"
  )) {
    const parent = resolveSymbol(symbols, edge.from);
    const attributes = Array.isArray(edge.metadata?.attributes)
      ? (edge.metadata.attributes as { name: string; value: string }[])
      : [];

    for (const attr of attributes) {
      const parentLabel = parent
        ? `${parent.name} (${parent.filePath}:${formatLines(parent)})`
        : edge.from;
      lines.push(
        `  ${attr.name} ← ${attr.value} from ${parentLabel} (prop source not resolved — re-index)`
      );
    }
  }

  return lines;
}

export interface CallChainNode {
  id: string;
  label: string;
  depth: number;
  kind: "internal" | "builtin" | "external";
}

export function walkCallChain(
  rootId: string,
  symbols: SymbolInfo[],
  edges: CodeGraph["edges"],
  maxDepth = 6
): CallChainNode[] {
  const chain: CallChainNode[] = [];
  const visited = new Set<string>();

  function kindFor(id: string): CallChainNode["kind"] {
    if (id.startsWith("builtin:")) {
      return "builtin";
    }
    if (id.startsWith("external:")) {
      return "external";
    }
    return "internal";
  }

  function labelFor(id: string, metadata?: Record<string, unknown>): string {
    if (id.startsWith("builtin:") || id.startsWith("external:")) {
      return formatCallTarget(id, symbols, metadata);
    }

    const symbol = resolveSymbol(symbols, id);
    return symbol ? symbol.name : id;
  }

  function walk(fromId: string, depth: number): void {
    if (depth > maxDepth) {
      return;
    }

    const outgoing = edges.filter(
      (edge) =>
        edge.from === fromId &&
        (edge.type === "calls" || edge.type === "uses_hook")
    );

    for (const edge of outgoing) {
      const visitKey = `${fromId}->${edge.to}`;
      if (visited.has(visitKey)) {
        continue;
      }
      visited.add(visitKey);

      chain.push({
        depth,
        id: edge.to,
        kind: kindFor(edge.to),
        label: labelFor(edge.to, edge.metadata),
      });

      if (!edge.to.startsWith("builtin:") && !edge.to.startsWith("external:")) {
        walk(edge.to, depth + 1);
      }
    }
  }

  walk(rootId, 1);
  return chain;
}

export function buildCallChainLines(
  rootId: string,
  symbols: SymbolInfo[],
  edges: CodeGraph["edges"],
  maxDepth = 6
): string[] {
  const root = resolveSymbol(symbols, rootId);
  const chain = walkCallChain(rootId, symbols, edges, maxDepth);

  if (chain.length === 0) {
    const hookNames = new Set(root?.usesHooks ?? []);
    const unresolved = (root?.calls ?? []).filter(
      (call) => !hookNames.has(call.split(".")[0] ?? call)
    );

    return unresolved.length > 0
      ? unresolved.map((call) => `  ${call} (unresolved — re-index)`)
      : [];
  }

  return chain.map((node) => {
    const indent = "  ".repeat(node.depth);
    const tag =
      node.kind === "builtin"
        ? "builtin"
        : node.kind === "external"
          ? "external"
          : "internal";
    return `${indent}→ ${node.label} [${tag}]`;
  });
}

export function buildDeepCallChainForComponent(
  symbol: SymbolInfo,
  symbols: SymbolInfo[],
  edges: CodeGraph["edges"]
): string[] {
  const lines: string[] = [];
  const hooks = getDirectHooks(symbol.id, symbols, edges);

  for (const hook of hooks) {
    lines.push(`${hook.name}:`);
    lines.push(...buildCallChainLines(hook.id, symbols, edges));
  }

  if (hooks.length === 0) {
    const directCalls = buildCallChainLines(symbol.id, symbols, edges);
    if (directCalls.length > 0) {
      lines.push(`${symbol.name}:`);
      lines.push(...directCalls);
    }
  }

  for (const edge of edges.filter(
    (item) => item.to === symbol.id && item.type === "passes_prop"
  )) {
    const parent = resolveSymbol(symbols, edge.from);
    if (!parent) {
      continue;
    }

    const parentCalls = buildCallChainLines(parent.id, symbols, edges);
    if (parentCalls.length > 0) {
      lines.push(`via parent ${parent.name}:`);
      lines.push(...parentCalls);
    }
  }

  return lines;
}

export function collectTraceGraphNodes(
  symbol: SymbolInfo,
  symbols: SymbolInfo[],
  edges: CodeGraph["edges"]
): CodeGraph["nodes"] {
  const nodeIds = new Set<string>([symbol.id]);

  for (const edge of edges) {
    nodeIds.add(edge.from);
    nodeIds.add(edge.to);
  }

  const nodes: CodeGraph["nodes"] = [];

  for (const id of nodeIds) {
    const resolved = resolveSymbol(symbols, id);
    if (resolved) {
      nodes.push({
        filePath: resolved.filePath,
        id: resolved.id,
        label: resolved.name,
        type:
          resolved.type === "component"
            ? "component"
            : resolved.type === "hook"
              ? "hook"
              : resolved.type === "service"
                ? "service"
                : "function",
      });
      continue;
    }

    if (id.startsWith("builtin:")) {
      nodes.push({
        id,
        label: id.slice("builtin:".length),
        type: "builtin",
      });
      continue;
    }

    if (id.startsWith("external:")) {
      nodes.push({
        id,
        label: id.slice("external:".length).replace("#", " · "),
        type: "external",
      });
    }
  }

  return nodes;
}
