import { resolveProjectConfig } from "@cs/page-logic-visualizer/server";
import type { ResolvedProjectConfig } from "@cs/page-logic-visualizer/server";

let cached: Promise<ResolvedProjectConfig> | null = null;

export const getServerProjectConfig = (): Promise<ResolvedProjectConfig> => {
  if (process.env.NODE_ENV === "development") {
    return resolveProjectConfig();
  }
  if (!cached) {
    cached = resolveProjectConfig();
  }
  return cached;
};
