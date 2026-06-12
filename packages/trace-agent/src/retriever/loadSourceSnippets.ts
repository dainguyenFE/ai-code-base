import { readFile } from "node:fs/promises";
import path from "node:path";

import type { DbSymbol } from "@ai-trace/cache";
import type { FileSnippet } from "@ai-trace/types";

const MAX_SNIPPET_LINES = 120;

export async function loadSourceSnippets(
  rootDir: string,
  symbols: DbSymbol[],
  maxFiles: number
): Promise<{ files: FileSnippet[]; warnings: string[] }> {
  const warnings: string[] = [];
  const files: FileSnippet[] = [];
  const seen = new Set<string>();

  for (const symbol of symbols) {
    if (files.length >= maxFiles) {
      break;
    }

    const key = `${symbol.filePath}:${symbol.startLine}-${symbol.endLine}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    const snippet = await loadSymbolSnippet(rootDir, symbol);
    if (snippet) {
      files.push(snippet);
    } else {
      warnings.push(
        `Could not read source for ${symbol.name} (${symbol.filePath}).`
      );
    }
  }

  return { files, warnings };
}

async function loadSymbolSnippet(
  rootDir: string,
  symbol: DbSymbol
): Promise<FileSnippet | null> {
  const absolutePath = path.resolve(rootDir, symbol.filePath);

  try {
    const content = await readFile(absolutePath, "utf-8");
    const lines = content.split("\n");
    const start = Math.max(1, symbol.startLine);
    const end = Math.min(lines.length, symbol.endLine);
    const span = end - start + 1;
    const cappedEnd =
      span > MAX_SNIPPET_LINES ? start + MAX_SNIPPET_LINES - 1 : end;
    const code = lines.slice(start - 1, cappedEnd).join("\n");

    return {
      code,
      endLine: cappedEnd,
      path: symbol.filePath,
      startLine: start,
    };
  } catch {
    return null;
  }
}
