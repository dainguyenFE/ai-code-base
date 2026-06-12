import { readdirSync, statSync } from "node:fs";
import path from "node:path";

export const listSubdirectories = (dir: string): string[] => {
  try {
    return readdirSync(dir).filter((entry) => {
      try {
        return statSync(path.join(dir, entry)).isDirectory();
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
};

export const findFilesNamed = (
  dir: string,
  fileName: string,
  maxDepth = 8
): string[] => {
  const results: string[] = [];

  const walk = (currentDir: string, depth: number) => {
    if (depth > maxDepth) {
      return;
    }

    let entries: string[] = [];
    try {
      entries = readdirSync(currentDir);
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry);
      let isDirectory = false;
      try {
        isDirectory = statSync(fullPath).isDirectory();
      } catch {
        continue;
      }

      if (entry === fileName && !isDirectory) {
        results.push(fullPath);
      }

      if (isDirectory) {
        walk(fullPath, depth + 1);
      }
    }
  };

  walk(dir, 0);
  return results;
};
