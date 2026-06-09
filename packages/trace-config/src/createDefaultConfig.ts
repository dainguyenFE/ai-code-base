import type { TraceConfig } from "@ai-trace/types";

export function createDefaultConfig(projectName: string): TraceConfig {
  return {
    projectName,
    framework: "nextjs",
    router: "app-router",
    sourceRoots: ["app", "components", "hooks", "lib", "features", "packages"],
    ignore: [
      "node_modules",
      ".next",
      "dist",
      "build",
      "coverage",
      ".turbo",
      ".git",
    ],
    cacheDir: ".ai-trace/cache",
    exportDir: ".ai-trace/exports",
    traceResultDir: ".ai-trace/trace-results",
    indexVersion: "v1",
    db: {
      type: "sqlite",
      path: ".ai-trace/cache/index.sqlite",
    },
  };
}
