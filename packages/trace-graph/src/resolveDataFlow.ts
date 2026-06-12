import { primaryCalleeFromFlow } from "@ai-trace/parser";
import type { DataFlowNode, ParsedFile, SymbolInfo } from "@ai-trace/types";

import { classifyUnresolvedCall } from "./resolveCallTarget.js";
import { resolveRelativeModule } from "./resolveModule.js";

function symbolNodeId(symbol: SymbolInfo): string {
  return symbol.id;
}

function allSymbolsFlat(
  symbolsByName: Map<string, SymbolInfo[]>
): SymbolInfo[] {
  return [...symbolsByName.values()].flat();
}

export function resolveSameFileTarget(
  name: string,
  filePath: string,
  symbolsByName: Map<string, SymbolInfo[]>
): string | null {
  const matches = allSymbolsFlat(symbolsByName).filter(
    (symbol) => symbol.filePath === filePath && symbol.name === name
  );

  if (matches.length === 0) {
    return null;
  }

  const preferred =
    matches.find((symbol) => symbol.type === "hook") ??
    matches.find((symbol) => symbol.type === "service") ??
    matches.find((symbol) => symbol.type === "function") ??
    matches.find((symbol) => symbol.type === "component") ??
    matches[0];

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

function resolveSymbolTarget(
  name: string,
  symbolsByName: Map<string, SymbolInfo[]>
): string | null {
  const candidates = symbolsByName.get(name);
  if (!candidates || candidates.length === 0) {
    return null;
  }

  const preferred =
    candidates.find((symbol) => symbol.type === "service") ??
    candidates.find((symbol) => symbol.type === "hook") ??
    candidates.find((symbol) => symbol.type === "function") ??
    candidates.find((symbol) => symbol.type === "component") ??
    candidates[0];

  return preferred ? symbolNodeId(preferred) : null;
}

export function resolveCallNameTarget(
  callee: string,
  fromFile: string,
  parsedFiles: ParsedFile[],
  knownPaths: Set<string>,
  symbolsByName: Map<string, SymbolInfo[]>
): {
  id: string;
  kind: "internal" | "builtin" | "external";
  label: string;
  moduleSpecifier?: string;
} {
  const rootCall = callee.split(".")[0] ?? callee;

  const toId =
    resolveSameFileTarget(rootCall, fromFile, symbolsByName) ??
    resolveSymbolTargetFromImports(
      rootCall,
      fromFile,
      parsedFiles,
      knownPaths,
      symbolsByName
    ) ??
    resolveSymbolTarget(rootCall, symbolsByName);

  if (toId) {
    return { id: toId, kind: "internal", label: callee };
  }

  const external = classifyUnresolvedCall(callee, fromFile, parsedFiles);
  return {
    id: external.id,
    kind: external.kind,
    label: callee,
    moduleSpecifier: external.moduleSpecifier,
  };
}

export function resolveFlowTarget(
  flow: DataFlowNode,
  fromFile: string,
  parsedFiles: ParsedFile[],
  knownPaths: Set<string>,
  symbolsByName: Map<string, SymbolInfo[]>
): {
  id: string;
  kind: "internal" | "builtin" | "external";
  label: string;
} | null {
  const callee = primaryCalleeFromFlow(flow);
  if (callee) {
    return resolveCallNameTarget(
      callee,
      fromFile,
      parsedFiles,
      knownPaths,
      symbolsByName
    );
  }

  if (flow.kind === "identifier" && flow.children?.length === 1) {
    return resolveFlowTarget(
      flow.children[0],
      fromFile,
      parsedFiles,
      knownPaths,
      symbolsByName
    );
  }

  if (flow.kind === "await" && flow.children?.length === 1) {
    return resolveFlowTarget(
      flow.children[0],
      fromFile,
      parsedFiles,
      knownPaths,
      symbolsByName
    );
  }

  if (flow.kind === "member" && flow.children?.length === 1) {
    return resolveFlowTarget(
      flow.children[0],
      fromFile,
      parsedFiles,
      knownPaths,
      symbolsByName
    );
  }

  return null;
}
