import type {
  CodeGraph,
  ExecutionStepRecord,
  GraphEdge,
  GraphNode,
  ParsedFile,
  RouteInfo,
  ScannedFile,
  SymbolInfo,
} from "@ai-trace/types";

import { buildRouteGraphEdges } from "./buildRouteGraph.js";
import { detectRoutes } from "./detectRoutes.js";
import { resolveCallNameTarget, resolveFlowTarget } from "./resolveDataFlow.js";
import { resolveRelativeModule } from "./resolveModule.js";

function makeEdgeId(from: string, to: string, type: string): string {
  return `${from}->${to}:${type}`;
}

function symbolNodeId(symbol: SymbolInfo): string {
  return symbol.id;
}

function allSymbolsFlat(
  symbolsByName: Map<string, SymbolInfo[]>
): SymbolInfo[] {
  return [...symbolsByName.values()].flat();
}

function resolveSymbolTarget(
  name: string,
  allSymbols: Map<string, SymbolInfo[]>
): string | null {
  const candidates = allSymbols.get(name);
  if (!candidates || candidates.length === 0) {
    return null;
  }

  const preferred =
    candidates.find((s) => s.type === "component") ??
    candidates.find((s) => s.type === "hook") ??
    candidates[0];

  return preferred ? symbolNodeId(preferred) : null;
}

function resolveSymbolTargetFromImports(
  name: string,
  fromFile: string,
  parsedFiles: ParsedFile[],
  knownPaths: Set<string>,
  symbolsByName: Map<string, SymbolInfo[]>
): string | null {
  const parsed = parsedFiles.find((file) => file.filePath === fromFile);
  if (!parsed) {
    return null;
  }

  for (const imp of parsed.imports) {
    const matchesImport =
      imp.defaultImport === name ||
      imp.named.includes(name) ||
      imp.named.some((item) => item.split(" as ")[0] === name);

    if (!matchesImport) {
      continue;
    }

    const resolved = resolveRelativeModule(fromFile, imp.source, knownPaths);
    if (!resolved) {
      continue;
    }

    const symbol = allSymbolsFlat(symbolsByName).find(
      (item) => item.filePath === resolved && item.name === name
    );
    if (symbol) {
      return symbolNodeId(symbol);
    }
  }

  return null;
}

function resolveRenderTarget(
  name: string,
  fromFile: string,
  parsedFiles: ParsedFile[],
  knownPaths: Set<string>,
  symbolsByName: Map<string, SymbolInfo[]>
): string | null {
  return (
    resolveSymbolTargetFromImports(
      name,
      fromFile,
      parsedFiles,
      knownPaths,
      symbolsByName
    ) ?? resolveSymbolTarget(name, symbolsByName)
  );
}

function resolveComponentInFile(
  filePath: string,
  symbolsByName: Map<string, SymbolInfo[]>
): SymbolInfo | null {
  const symbols = allSymbolsFlat(symbolsByName).filter(
    (symbol) => symbol.filePath === filePath && symbol.type === "component"
  );
  return symbols[0] ?? null;
}

function resolveStepTarget(
  step: ExecutionStepRecord,
  symbol: SymbolInfo,
  parsedFiles: ParsedFile[],
  knownPaths: Set<string>,
  symbolsByName: Map<string, SymbolInfo[]>,
  addNode: (node: GraphNode) => void
): string | null {
  if (!step.target || step.kind === "branch") {
    return null;
  }

  if (step.kind === "render") {
    return resolveRenderTarget(
      step.target,
      symbol.filePath,
      parsedFiles,
      knownPaths,
      symbolsByName
    );
  }

  const target = resolveCallNameTarget(
    step.target,
    symbol.filePath,
    parsedFiles,
    knownPaths,
    symbolsByName
  );

  if (target.kind !== "internal") {
    addNode({
      id: target.id,
      label: target.label,
      type: target.kind === "builtin" ? "builtin" : "external",
    });
  }

  return target.id;
}

function addSequenceEdgesForSymbol(
  symbol: SymbolInfo,
  parsedFiles: ParsedFile[],
  knownPaths: Set<string>,
  symbolsByName: Map<string, SymbolInfo[]>,
  addEdge: (edge: GraphEdge) => void,
  addNode: (node: GraphNode) => void
): void {
  const steps = symbol.executionSteps ?? [];
  if (steps.length === 0) {
    return;
  }

  const fromId = symbolNodeId(symbol);
  let sequenceRank = 0;
  const seenTargets = new Set<string>();

  for (const step of steps) {
    if (step.kind === "branch") {
      continue;
    }

    const toId = resolveStepTarget(
      step,
      symbol,
      parsedFiles,
      knownPaths,
      symbolsByName,
      addNode
    );
    if (!toId || toId === fromId) {
      continue;
    }

    const targetKey = `${step.kind}:${toId}`;
    if (seenTargets.has(targetKey)) {
      continue;
    }
    seenTargets.add(targetKey);

    sequenceRank += 1;

    // Execution steps always originate from the owning symbol (page/component),
    // not from the previous callee — render happens in BlogDetailPage, not in getBlogDetail.
    addEdge({
      from: fromId,
      id: makeEdgeId(fromId, toId, `sequence:${step.order}`),
      metadata: {
        line: step.line,
        order: step.order,
        sequenceRank,
        stepKind: step.kind,
      },
      to: toId,
      type: "sequence",
    });
  }
}

export function buildGraph(
  parsedFiles: ParsedFile[],
  scannedFiles: ScannedFile[],
  routes: RouteInfo[] = detectRoutes(scannedFiles)
): CodeGraph {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const symbolsByName = new Map<string, SymbolInfo[]>();
  const knownPaths = new Set(
    scannedFiles.map((file) => file.path.replaceAll("\\", "/"))
  );

  const addNode = (node: GraphNode) => {
    nodes.set(node.id, node);
  };

  const addEdge = (edge: GraphEdge) => {
    edges.set(edge.id, edge);
  };

  for (const file of scannedFiles) {
    addNode({
      filePath: file.path,
      id: `file:${file.path}`,
      label: file.path,
      type: "file",
    });
  }

  for (const route of routes) {
    addNode({
      filePath: route.pageFile,
      id: route.id,
      label: route.path,
      type: "route",
    });
  }

  for (const parsed of parsedFiles) {
    for (const imp of parsed.imports) {
      const fromId = `file:${parsed.filePath}`;
      const toId = `file:${imp.source}`;
      addEdge({
        from: fromId,
        id: makeEdgeId(fromId, toId, "imports"),
        to: toId,
        type: "imports",
      });
    }

    for (const symbol of parsed.symbols) {
      addNode({
        filePath: symbol.filePath,
        id: symbolNodeId(symbol),
        label: symbol.name,
        type:
          symbol.type === "component"
            ? "component"
            : symbol.type === "hook"
              ? "hook"
              : symbol.type === "service"
                ? "service"
                : "function",
      });

      const list = symbolsByName.get(symbol.name) ?? [];
      list.push(symbol);
      symbolsByName.set(symbol.name, list);
    }
  }

  for (const parsed of parsedFiles) {
    for (const symbol of parsed.symbols) {
      const fromId = symbolNodeId(symbol);

      for (const render of symbol.renders ?? []) {
        const toId = resolveRenderTarget(
          render,
          symbol.filePath,
          parsedFiles,
          knownPaths,
          symbolsByName
        );
        if (toId) {
          addEdge({
            from: fromId,
            id: makeEdgeId(fromId, toId, "renders"),
            to: toId,
            type: "renders",
          });
        }
      }

      for (const [index, passed] of (symbol.passedProps ?? []).entries()) {
        const toId = resolveRenderTarget(
          passed.target,
          symbol.filePath,
          parsedFiles,
          knownPaths,
          symbolsByName
        );
        if (!toId) {
          continue;
        }

        const propsSummary = passed.attributes
          .map((attr) => `${attr.name}=${attr.value}`)
          .join(", ");

        addEdge({
          from: fromId,
          id: makeEdgeId(fromId, toId, `passes_prop:${index}`),
          metadata: {
            attributes: passed.attributes,
            props: propsSummary,
            target: passed.target,
          },
          to: toId,
          type: "passes_prop",
        });
      }

      for (const flow of symbol.propFlows ?? []) {
        const childId = resolveRenderTarget(
          flow.targetComponent,
          symbol.filePath,
          parsedFiles,
          knownPaths,
          symbolsByName
        );
        if (!childId) {
          continue;
        }

        const resolved = resolveFlowTarget(
          flow.source,
          symbol.filePath,
          parsedFiles,
          knownPaths,
          symbolsByName
        );

        if (!resolved) {
          continue;
        }

        if (resolved.kind !== "internal") {
          addNode({
            id: resolved.id,
            label: resolved.label,
            type: resolved.kind === "builtin" ? "builtin" : "external",
          });
        }

        addEdge({
          from: resolved.id,
          id: makeEdgeId(
            resolved.id,
            childId,
            `prop_source:${flow.propName}:${flow.line}`
          ),
          metadata: {
            callee: resolved.label,
            jsxValue: flow.jsxValue,
            line: flow.line,
            passedFrom: fromId,
            propName: flow.propName,
            sourceFlow: flow.source,
            targetComponent: flow.targetComponent,
          },
          to: childId,
          type: "prop_source",
        });
      }

      for (const dyn of symbol.dynamicImports ?? []) {
        const resolved = resolveRelativeModule(
          symbol.filePath,
          dyn.moduleSpecifier,
          knownPaths
        );

        if (!resolved) {
          continue;
        }

        const targetSymbol = resolveComponentInFile(resolved, symbolsByName);
        const toId = targetSymbol
          ? symbolNodeId(targetSymbol)
          : `file:${resolved}`;

        addEdge({
          from: fromId,
          id: makeEdgeId(fromId, toId, `dynamic_imports:${dyn.line}`),
          metadata: {
            kind: dyn.kind,
            line: dyn.line,
            moduleSpecifier: dyn.moduleSpecifier,
            resolvedFile: resolved,
            targetComponent: targetSymbol?.name,
          },
          to: toId,
          type: "dynamic_imports",
        });
      }

      for (const hook of symbol.usesHooks ?? []) {
        const toId = resolveRenderTarget(
          hook,
          symbol.filePath,
          parsedFiles,
          knownPaths,
          symbolsByName
        );
        if (toId) {
          addEdge({
            from: fromId,
            id: makeEdgeId(fromId, toId, "uses_hook"),
            to: toId,
            type: "uses_hook",
          });
        }
      }

      const hookNames = new Set(symbol.usesHooks ?? []);
      const callSites = symbol.callSites ?? [];
      const seenCallEdges = new Set<string>();

      for (const site of callSites) {
        const rootCall = site.callee.split(".")[0] ?? site.callee;
        if (hookNames.has(rootCall)) {
          continue;
        }

        const target = resolveCallNameTarget(
          site.callee,
          symbol.filePath,
          parsedFiles,
          knownPaths,
          symbolsByName
        );

        const edgeKey = `${fromId}->${target.id}:calls:${site.line}`;
        if (seenCallEdges.has(edgeKey) || target.id === fromId) {
          continue;
        }
        seenCallEdges.add(edgeKey);

        if (target.kind !== "internal") {
          addNode({
            id: target.id,
            label: target.label,
            type: target.kind === "builtin" ? "builtin" : "external",
          });
        }

        addEdge({
          from: fromId,
          id: makeEdgeId(fromId, target.id, `calls:${site.line}`),
          metadata: {
            argumentExpressions: site.argumentExpressions,
            callee: site.callee,
            expression: site.expression,
            kind: target.kind,
            line: site.line,
            moduleSpecifier: target.moduleSpecifier,
            resolved: target.kind === "internal",
          },
          to: target.id,
          type: "calls",
        });
      }

      addSequenceEdgesForSymbol(
        symbol,
        parsedFiles,
        knownPaths,
        symbolsByName,
        addEdge,
        addNode
      );
    }
  }

  buildRouteGraphEdges({
    addEdge,
    addNode,
    allSymbols: allSymbolsFlat(symbolsByName),
    knownPaths,
    parsedFiles,
    resolveSymbolTarget: (name) => resolveSymbolTarget(name, symbolsByName),
    resolveSymbolTargetFromImports: (name, fromFile) =>
      resolveSymbolTargetFromImports(
        name,
        fromFile,
        parsedFiles,
        knownPaths,
        symbolsByName
      ),
    routes,
    symbolsByName,
  });

  return {
    edges: [...edges.values()],
    nodes: [...nodes.values()],
  };
}
