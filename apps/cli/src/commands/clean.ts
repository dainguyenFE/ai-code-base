import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";

import {
  createDefaultConfig,
  loadConfig,
  resolveConfigPaths,
} from "@ai-trace/config";

export interface CleanOptions {
  all?: boolean;
  cache?: boolean;
  exports?: boolean;
}

interface TracePaths {
  cacheDir: string;
  exportDir: string;
  traceResultDir: string;
}

async function resolveTracePaths(cwd: string): Promise<TracePaths> {
  const configPath = path.join(cwd, ".ai-trace/config.json");

  if (existsSync(configPath)) {
    const config = await loadConfig(cwd);
    return {
      cacheDir: config.absoluteCacheDir,
      exportDir: config.absoluteExportDir,
      traceResultDir: config.absoluteTraceResultDir,
    };
  }

  const config = resolveConfigPaths(
    createDefaultConfig(path.basename(cwd)),
    cwd
  );

  return {
    cacheDir: config.absoluteCacheDir,
    exportDir: config.absoluteExportDir,
    traceResultDir: config.absoluteTraceResultDir,
  };
}

async function removeDir(label: string, dirPath: string): Promise<void> {
  if (!existsSync(dirPath)) {
    console.log(`Skip ${label} (not found): ${dirPath}`);
    return;
  }

  await rm(dirPath, { force: true, recursive: true });
  console.log(`Removed ${label}: ${dirPath}`);
}

export async function runClean(
  cwd: string,
  options: CleanOptions
): Promise<void> {
  const { all, cache, exports: exportsFlag } = options;

  if (!cache && !exportsFlag && !all) {
    throw new Error("Specify at least one of --cache, --exports, or --all");
  }

  const paths = await resolveTracePaths(cwd);

  if (all || cache) {
    await removeDir("cache", paths.cacheDir);
  }

  if (all || exportsFlag) {
    await removeDir("exports", paths.exportDir);
  }

  if (all) {
    await removeDir("trace results", paths.traceResultDir);
  }
}
