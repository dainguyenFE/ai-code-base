import type { PageLogicVisualizerProjectConfig } from "./core/src/project-config";

/** Monorepo example (Turborepo / npm workspaces). */
export const monorepoConfig = {
  appsDirs: ["apps/*"],
  projectType: "monorepo",
  tsConfigPath: "tsconfig.json",
  workspacePackageDirs: ["packages/*"],
} satisfies PageLogicVisualizerProjectConfig;

/** Standalone Next.js app example. */
export const standaloneConfig = {
  appDir: ".",
  projectType: "standalone",
  tsConfigPath: "tsconfig.json",
} satisfies PageLogicVisualizerProjectConfig;

export default monorepoConfig;
