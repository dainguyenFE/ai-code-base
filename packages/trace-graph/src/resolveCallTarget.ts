import type { ParsedFile } from "@ai-trace/types";

const BUILTIN_ROOTS = new Set([
  "Array",
  "Boolean",
  "console",
  "Date",
  "fetch",
  "JSON",
  "Math",
  "Number",
  "Object",
  "parseInt",
  "parseFloat",
  "Promise",
  "setInterval",
  "setTimeout",
  "String",
  "URL",
  "URLSearchParams",
]);

export type CallTargetKind = "internal" | "builtin" | "external";

export interface ResolvedCallTarget {
  id: string;
  kind: CallTargetKind;
  label: string;
  moduleSpecifier?: string;
}

function rootIdentifier(name: string): string {
  return name.split(".")[0] ?? name;
}

function findImportModule(
  name: string,
  fromFile: string,
  parsedFiles: ParsedFile[]
): string | undefined {
  const parsed = parsedFiles.find((file) => file.filePath === fromFile);
  if (!parsed) {
    return undefined;
  }

  const root = rootIdentifier(name);

  for (const imp of parsed.imports) {
    if (imp.defaultImport === root || imp.named.includes(root)) {
      return imp.source;
    }

    const aliased = imp.named.find((item) => item.split(" as ")[0] === root);
    if (aliased) {
      return imp.source;
    }
  }

  return undefined;
}

export function classifyUnresolvedCall(
  name: string,
  fromFile: string,
  parsedFiles: ParsedFile[]
): ResolvedCallTarget {
  const root = rootIdentifier(name);

  if (BUILTIN_ROOTS.has(root)) {
    return {
      id: `builtin:${name}`,
      kind: "builtin",
      label: name,
    };
  }

  const moduleSpecifier = findImportModule(name, fromFile, parsedFiles);
  if (moduleSpecifier) {
    return {
      id: `external:${moduleSpecifier}#${name}`,
      kind: "external",
      label: `${name} (${moduleSpecifier})`,
      moduleSpecifier,
    };
  }

  return {
    id: `external:unknown#${name}`,
    kind: "external",
    label: name,
  };
}
