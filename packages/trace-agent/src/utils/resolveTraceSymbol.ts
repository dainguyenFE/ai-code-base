import type { TraceDatabase } from "@ai-trace/cache";
import { findSymbolByNameAndFile, findSymbolsByName } from "@ai-trace/cache";
import type { DbSymbol } from "@ai-trace/cache";
import type { SymbolType } from "@ai-trace/types";

import { duplicateSymbolWarning } from "./traceGraph.js";

export interface TraceSymbolOptions {
  file?: string;
}

export interface ResolvedTraceSymbol {
  symbol: DbSymbol;
  matches: DbSymbol[];
  warnings: string[];
}

export function resolveTraceSymbol(
  db: TraceDatabase,
  name: string,
  type: SymbolType,
  options: TraceSymbolOptions = {}
): ResolvedTraceSymbol {
  const matches = findSymbolsByName(db, name, type);

  if (matches.length === 0) {
    throw new Error(`${type} "${name}" not found. Run "ai-trace index" first.`);
  }

  if (options.file) {
    const match = findSymbolByNameAndFile(db, name, options.file, type);
    if (!match) {
      const candidates = matches
        .map(
          (symbol) => `${symbol.filePath}:${symbol.startLine}-${symbol.endLine}`
        )
        .join(", ");
      throw new Error(
        `${type} "${name}" not found for --file "${options.file}". Candidates: ${candidates}`
      );
    }

    return { matches, symbol: match, warnings: [] };
  }

  const warnings: string[] = [];
  const duplicate = duplicateSymbolWarning(name, matches);
  if (duplicate) {
    warnings.push(duplicate);
    warnings.push(
      `Use --file <path> to disambiguate, e.g. --file ${matches[0].filePath}`
    );
  }

  return {
    matches,
    symbol: matches[0],
    warnings,
  };
}
