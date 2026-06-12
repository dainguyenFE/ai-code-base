import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

import type { TraceConfig } from "@ai-trace/types";
import { z } from "zod";

import { createDefaultConfig } from "./createDefaultConfig.js";

const aiConfigSchema = z
  .object({
    baseUrl: z.string().optional(),
    enabled: z.boolean(),
    maxContextFiles: z.number().int().positive(),
    maxGraphDepth: z.number().int().positive(),
    model: z.string(),
    provider: z.enum(["openai", "ollama"]),
    saveTraceResult: z.boolean(),
    temperature: z.number().min(0).max(2),
  })
  .optional();

const configSchema = z.object({
  ai: aiConfigSchema,
  cacheDir: z.string(),
  db: z.object({
    path: z.string(),
    type: z.literal("sqlite"),
  }),
  exportDir: z.string(),
  framework: z.enum(["nextjs", "react", "unknown"]),
  ignore: z.array(z.string()),
  indexVersion: z.string(),
  projectName: z.string(),
  router: z.enum(["app-router", "pages-router", "unknown"]).optional(),
  sourceRoots: z.array(z.string()).min(1),
  traceResultDir: z.string(),
});

export const CONFIG_PATH = ".ai-trace/config.json";

export type ResolvedConfig = TraceConfig & {
  rootDir: string;
  absoluteCacheDir: string;
  absoluteExportDir: string;
  absoluteTraceResultDir: string;
  absoluteDbPath: string;
};

export function resolveConfigPaths(
  config: TraceConfig,
  rootDir: string
): ResolvedConfig {
  return {
    ...config,
    absoluteCacheDir: path.resolve(rootDir, config.cacheDir),
    absoluteDbPath: path.resolve(rootDir, config.db.path),
    absoluteExportDir: path.resolve(rootDir, config.exportDir),
    absoluteTraceResultDir: path.resolve(rootDir, config.traceResultDir),
    rootDir,
  };
}

export async function loadConfig(rootDir: string): Promise<ResolvedConfig> {
  const configPath = path.resolve(rootDir, CONFIG_PATH);

  if (!existsSync(configPath)) {
    throw new Error(
      `Config not found at ${CONFIG_PATH}. Run "ai-trace init" first.`
    );
  }

  const raw = JSON.parse(await readFile(configPath, "utf-8"));
  const config = configSchema.parse(raw) as TraceConfig;
  return resolveConfigPaths(config, rootDir);
}

export async function initConfig(rootDir: string): Promise<string> {
  const configDir = path.resolve(rootDir, ".ai-trace");
  const configPath = path.resolve(configDir, "config.json");

  if (existsSync(configPath)) {
    return configPath;
  }

  await mkdir(configDir, { recursive: true });
  const projectName = path.basename(rootDir);
  const config = createDefaultConfig(projectName);
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
  return configPath;
}
