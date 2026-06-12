import type { TraceConfig } from "@ai-trace/types";

export function createDefaultConfig(projectName: string): TraceConfig {
  return {
    ai: {
      baseUrl: "http://localhost:11434",
      enabled: false,
      maxContextFiles: 8,
      maxGraphDepth: 2,
      model: "qwen2.5-coder:7b",
      provider: "ollama",
      saveTraceResult: true,
      temperature: 0.1,
    },
    cacheDir: ".ai-trace/cache",
    db: {
      path: ".ai-trace/cache/index.sqlite",
      type: "sqlite",
    },
    exportDir: ".ai-trace/exports",
    framework: "nextjs",
    ignore: [
      "node_modules",
      ".next",
      "dist",
      "build",
      "coverage",
      ".turbo",
      ".git",
    ],
    indexVersion: "v1",
    projectName,
    router: "app-router",
    sourceRoots: ["app", "components", "hooks", "lib", "features", "packages"],
    traceResultDir: ".ai-trace/trace-results",
  };
}
