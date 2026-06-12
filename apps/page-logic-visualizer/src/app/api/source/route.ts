import { readFileSync } from "node:fs";
import path from "node:path";

import { resolveImport } from "@cs/page-logic-visualizer/server";
import { NextResponse } from "next/server";

import { getServerProjectConfig } from "@/lib/server-project-config";

const resolveSafePath = (
  filePath: string,
  projectRoot: string
): string | null => {
  const normalized = filePath.replaceAll("\\", "/");
  const absolute = path.isAbsolute(normalized)
    ? path.resolve(normalized)
    : path.resolve(projectRoot, normalized.replace(/^\//, ""));

  if (
    absolute !== projectRoot &&
    !absolute.startsWith(`${projectRoot}${path.sep}`)
  ) {
    return null;
  }
  return absolute;
};

const findSymbolRange = (
  content: string,
  symbolName: string
): { startLine: number; endLine: number } | undefined => {
  const lines = content.split("\n");
  const patterns = [
    new RegExp(`export\\s+async\\s+function\\s+${symbolName}\\b`),
    new RegExp(`export\\s+function\\s+${symbolName}\\b`),
    new RegExp(`async\\s+function\\s+${symbolName}\\b`),
    new RegExp(`function\\s+${symbolName}\\b`),
    new RegExp(`export\\s+const\\s+${symbolName}\\b`),
    new RegExp(`const\\s+${symbolName}\\s*=`),
  ];

  let startLine = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (patterns.some((pattern) => pattern.test(lines[index] ?? ""))) {
      startLine = index + 1;
      break;
    }
  }

  if (startLine === -1) {
    return undefined;
  }

  let braceDepth = 0;
  let foundOpen = false;
  let endLine = startLine;

  for (let index = startLine - 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    for (const char of line) {
      if (char === "{") {
        braceDepth += 1;
        foundOpen = true;
      } else if (char === "}") {
        braceDepth -= 1;
      }
    }
    endLine = index + 1;
    if (foundOpen && braceDepth <= 0) {
      break;
    }
    if (!foundOpen && index > startLine + 2) {
      endLine = Math.min(startLine + 30, lines.length);
      break;
    }
  }

  return { endLine, startLine };
};

const findSearchLine = (
  content: string,
  searchText: string
): number | undefined => {
  const lines = content.split("\n");
  const trimmed = searchText.trim();
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index]?.includes(trimmed)) {
      return index + 1;
    }
  }
  return undefined;
};

const resolveSymbolFile = (
  parentFilePath: string,
  symbolName: string,
  projectRoot: string,
  tsConfigPath: string
): string | undefined => {
  const parentAbsolute = resolveSafePath(parentFilePath, projectRoot);
  if (!parentAbsolute) {
    return undefined;
  }

  const parentContent = readFileSync(parentAbsolute, "utf-8");
  const importPattern =
    /import\s+(?:type\s+)?(?:\{([^}]+)\}|(\w+))\s+from\s+['"]([^'"]+)['"]/g;

  let moduleSpecifier: string | undefined;
  for (const match of parentContent.matchAll(importPattern)) {
    const namedImports = match[1];
    const defaultImport = match[2];
    const modulePath = match[3];
    if (defaultImport === symbolName) {
      moduleSpecifier = modulePath;
      break;
    }
    if (namedImports) {
      const names = namedImports
        .split(",")
        .map((part) =>
          part
            .trim()
            .split(/\s+as\s+/)[0]
            ?.trim()
        )
        .filter(Boolean);
      if (names.includes(symbolName)) {
        moduleSpecifier = modulePath;
        break;
      }
    }
  }

  if (!moduleSpecifier) {
    return parentFilePath;
  }

  const { resolvedPath } = resolveImport({
    currentFile: parentFilePath,
    moduleSpecifier,
    rootDir: projectRoot,
    tsConfigPath: path.join(projectRoot, tsConfigPath),
  });

  if (!resolvedPath) {
    return parentFilePath;
  }

  return resolvedPath
    .replace(`${projectRoot}${path.sep}`, "")
    .replaceAll("\\", "/");
};

export async function GET(request: Request) {
  const config = await getServerProjectConfig();
  const { searchParams } = new URL(request.url);
  const filePath = searchParams.get("filePath");
  const parentFilePath = searchParams.get("parentFilePath") ?? undefined;
  const symbolName = searchParams.get("symbolName") ?? undefined;
  const searchText = searchParams.get("searchText") ?? undefined;
  const startLineParam = searchParams.get("startLine");
  const endLineParam = searchParams.get("endLine");

  if (!filePath) {
    return NextResponse.json(
      { error: "filePath is required" },
      { status: 400 }
    );
  }

  const resolvedFilePath =
    parentFilePath && symbolName && !startLineParam
      ? (resolveSymbolFile(
          parentFilePath,
          symbolName,
          config.rootDir,
          config.tsConfigPath
        ) ?? filePath)
      : filePath;

  const absolutePath = resolveSafePath(resolvedFilePath, config.rootDir);
  if (!absolutePath) {
    return NextResponse.json({ error: "Invalid file path" }, { status: 403 });
  }

  try {
    const content = readFileSync(absolutePath, "utf-8");
    let startLine = startLineParam ? Number(startLineParam) : undefined;
    let endLine = endLineParam ? Number(endLineParam) : undefined;

    if (symbolName && !startLine) {
      const range = findSymbolRange(content, symbolName);
      if (range) {
        ({ startLine } = range);
        ({ endLine } = range);
      }
    }

    if (searchText && !startLine) {
      const line = findSearchLine(content, searchText);
      if (line) {
        startLine = line;
        endLine = line;
      }
    }

    return NextResponse.json({
      content,
      endLine,
      filePath: resolvedFilePath.replaceAll("\\", "/"),
      startLine,
      totalLines: content.split("\n").length,
    });
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}
