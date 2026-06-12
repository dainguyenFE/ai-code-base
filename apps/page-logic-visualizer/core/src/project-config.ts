import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { mergeAnalyzerConfig } from "./config";
import type { AnalyzerConfig } from "./types";

export type ProjectType = "monorepo" | "standalone";

export interface PageLogicVisualizerProjectConfig extends AnalyzerConfig {
  /** `monorepo` scans multiple apps; `standalone` targets a single Next.js app. */
  projectType: ProjectType;
  /** Project root. Defaults to the directory containing the config file. */
  rootDir?: string;
  /** Monorepo: glob patterns for app directories (e.g. `apps/*`). */
  appsDirs?: string[];
  /** Monorepo: workspace package directories for import resolution. */
  workspacePackageDirs?: string[];
  /** Standalone: app directory relative to rootDir (default `.`). */
  appDir?: string;
  /** Monorepo: app dirs to omit from the app picker (e.g. the visualizer itself). */
  excludeApps?: string[];
  tsConfigPath?: string;
}

export interface ResolvedProjectConfig
  extends
    Required<
      Pick<
        PageLogicVisualizerProjectConfig,
        | "projectType"
        | "rootDir"
        | "appsDirs"
        | "workspacePackageDirs"
        | "appDir"
        | "tsConfigPath"
      >
    >,
    Required<AnalyzerConfig> {
  configFilePath: string | null;
  excludeApps: string[];
}

const CONFIG_FILENAMES = [
  "page-logic-visualizer.config.json",
  "page-logic-visualizer.config.ts",
  "page-logic-visualizer.config.mts",
  "page-logic-visualizer.config.js",
  "page-logic-visualizer.config.mjs",
] as const;

const expandGlob = (rootDir: string, pattern: string): string[] => {
  const normalized = pattern.replaceAll("\\", "/");
  const base = normalized.includes("/") ? path.dirname(normalized) : ".";
  const globPart = normalized.includes("/")
    ? path.basename(normalized)
    : normalized;

  const searchDir = path.resolve(rootDir, base);
  if (!existsSync(searchDir)) {
    return [];
  }

  return readdirSync(searchDir)
    .filter((entry) => {
      if (globPart === "*") {
        return true;
      }
      if (!globPart.includes("*")) {
        return entry === globPart;
      }
      const regex = new RegExp(
        `^${globPart.replaceAll(".", "\\.").replaceAll("*", ".*")}$`
      );
      return regex.test(entry);
    })
    .map((entry) =>
      normalizeProjectPath(path.relative(rootDir, path.join(searchDir, entry)))
    )
    .filter((entry) => {
      const absolute = path.resolve(rootDir, entry);
      return (
        existsSync(path.join(absolute, "package.json")) ||
        existsSync(path.join(absolute, "src/app")) ||
        existsSync(path.join(absolute, "app"))
      );
    })
    .toSorted();
};

const normalizeProjectPath = (value: string): string =>
  value.split(path.sep).join("/");

const detectProjectType = (
  rootDir: string,
  explicit?: ProjectType
): ProjectType => {
  if (explicit) {
    return explicit;
  }
  if (existsSync(path.join(rootDir, "apps"))) {
    return "monorepo";
  }
  return "standalone";
};

const isNextServer = (): boolean =>
  Boolean(process.env.NEXT_RUNTIME) ||
  process.env.npm_lifecycle_event === "dev";

const loadConfigModule = async (
  configPath: string
): Promise<PageLogicVisualizerProjectConfig> => {
  if (!existsSync(configPath)) {
    return {};
  }

  if (configPath.endsWith(".json")) {
    const raw = readFileSync(configPath, "utf-8");
    return JSON.parse(raw) as PageLogicVisualizerProjectConfig;
  }

  // Next.js cannot load arbitrary TS/JS config files outside the app bundle.
  if (isNextServer()) {
    return {};
  }

  const mod = await import(pathToFileURL(configPath).href);
  return (mod.default ?? mod) as PageLogicVisualizerProjectConfig;
};

const resolveConfigFilePath = (
  startDir: string,
  explicitPath?: string
): string | null => {
  if (explicitPath) {
    const resolved = path.isAbsolute(explicitPath)
      ? explicitPath
      : path.resolve(startDir, explicitPath);
    if (existsSync(resolved)) {
      return resolved;
    }
    if (resolved.endsWith(".ts") || resolved.endsWith(".mts")) {
      const jsonSibling = resolved.replace(/\.m?ts$/, ".json");
      if (existsSync(jsonSibling)) {
        return jsonSibling;
      }
    }
  }

  return findConfigFile(startDir);
};

export const findConfigFile = (startDir: string): string | null => {
  let current = path.resolve(startDir);

  while (true) {
    for (const filename of CONFIG_FILENAMES) {
      const candidate = path.join(current, filename);
      if (existsSync(candidate)) {
        return candidate;
      }
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
};

export const resolveProjectConfig = async (
  options: {
    startDir?: string;
    rootDir?: string;
    configPath?: string;
  } = {}
): Promise<ResolvedProjectConfig> => {
  const envRoot = process.env.PAGE_LOGIC_VISUALIZER_ROOT;
  const envConfig = process.env.PAGE_LOGIC_VISUALIZER_CONFIG;

  // Target project root: env (CLI) > explicit option > walk up from cwd (Next dev server).
  const startDir =
    envRoot ?? options.rootDir ?? options.startDir ?? process.cwd();
  const configFilePath = resolveConfigFilePath(
    startDir,
    options.configPath ?? (envConfig || undefined)
  );

  const loaded = configFilePath
    ? await loadConfigModule(
        path.isAbsolute(configFilePath)
          ? configFilePath
          : path.resolve(startDir, configFilePath)
      )
    : ({} as PageLogicVisualizerProjectConfig);

  const configDir = configFilePath
    ? path.dirname(
        path.isAbsolute(configFilePath)
          ? configFilePath
          : path.resolve(startDir, configFilePath)
      )
    : path.resolve(startDir);

  const rootDir = path.resolve(
    envRoot ?? loaded.rootDir ?? options.rootDir ?? configDir
  );

  const projectType = detectProjectType(rootDir, loaded.projectType);
  const analyzer = mergeAnalyzerConfig(loaded);

  const appsDirPatterns =
    loaded.appsDirs ?? (projectType === "monorepo" ? ["apps/*"] : []);
  const appsDirs = appsDirPatterns.flatMap((pattern) =>
    pattern.includes("*") ? expandGlob(rootDir, pattern) : [pattern]
  );

  const appDir =
    loaded.appDir ??
    (projectType === "standalone" ? "." : (appsDirs[0] ?? "."));

  return {
    ...analyzer,
    appDir: normalizeProjectPath(appDir),
    appsDirs: appsDirs.map(normalizeProjectPath),
    configFilePath,
    excludeApps: (loaded.excludeApps ?? []).map(normalizeProjectPath),
    projectType,
    rootDir,
    tsConfigPath: loaded.tsConfigPath ?? "tsconfig.json",
    workspacePackageDirs: (
      loaded.workspacePackageDirs ??
      (projectType === "monorepo" ? ["packages/*"] : [])
    ).flatMap((pattern) =>
      pattern.includes("*") ? expandGlob(rootDir, pattern) : [pattern]
    ),
  };
};

export const listProjectApps = (config: ResolvedProjectConfig): string[] => {
  const exclude = new Set(config.excludeApps);

  let apps: string[];
  if (config.projectType === "standalone") {
    apps = [config.appDir];
  } else if (config.appsDirs.length > 0) {
    apps = config.appsDirs;
  } else {
    apps = expandGlob(config.rootDir, "apps/*");
  }

  return apps.filter((app) => !exclude.has(normalizeProjectPath(app)));
};

export const defaultAppDir = (config: ResolvedProjectConfig): string => {
  const apps = listProjectApps(config);
  return apps[0] ?? config.appDir;
};
