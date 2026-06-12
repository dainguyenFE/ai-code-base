import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { ScannedFile } from "@ai-trace/types";
import fg from "fast-glob";

export interface ScanInput {
  rootDir: string;
  sourceRoots: string[];
  ignore: string[];
}

const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function getLanguage(filePath: string): ScannedFile["language"] {
  const ext = path.extname(filePath);
  if (ext === ".tsx") {
    return "tsx";
  }
  if (ext === ".ts") {
    return "ts";
  }
  if (ext === ".jsx") {
    return "jsx";
  }
  return "js";
}

export async function scanFiles(input: ScanInput): Promise<ScannedFile[]> {
  const { rootDir, sourceRoots, ignore } = input;
  const patterns = sourceRoots.map((root) =>
    path.posix.join(root.replaceAll("\\", "/"), "**/*.{ts,tsx,js,jsx}")
  );

  const entries = await fg(patterns, {
    absolute: true,
    cwd: rootDir,
    dot: false,
    ignore: ignore.map((item) => `**/${item}/**`),
    onlyFiles: true,
  });

  const files: ScannedFile[] = [];

  for (const absolutePath of entries) {
    const ext = path.extname(absolutePath);
    if (!EXTENSIONS.has(ext)) {
      continue;
    }

    const content = await readFile(absolutePath, "utf-8");
    const relativePath = path
      .relative(rootDir, absolutePath)
      .replaceAll("\\", "/");

    files.push({
      absolutePath,
      content,
      hash: hashContent(content),
      language: getLanguage(relativePath),
      path: relativePath,
    });
  }

  return [...files].toSorted((a, b) => a.path.localeCompare(b.path));
}
