import { createHash } from "node:crypto";

import type { SymbolType } from "@ai-trace/types";

export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function makeSymbolId(
  type: SymbolType,
  name: string,
  filePath: string
): string {
  const normalizedPath = filePath.replaceAll("\\", "/");
  return `${type}:${name}@${normalizedPath}`;
}

export function isPascalCase(name: string): boolean {
  return /^[A-Z][a-zA-Z0-9]*$/.test(name);
}

export function isHookName(name: string): boolean {
  return /^use[A-Z]/.test(name);
}

export function isJsxFile(filePath: string): boolean {
  return filePath.endsWith(".tsx") || filePath.endsWith(".jsx");
}
