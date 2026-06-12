import type { AnalyzerConfig, PageLogicVisualizerConfig } from "./types";
import { DEFAULT_INCLUDE_HTML_TAGS } from "./utils/semanticHtml";

export const DEFAULT_ANALYZER_CONFIG: Required<AnalyzerConfig> = {
  ignoreComponents: ["Fragment", "Suspense"],
  importantComponentPatterns: [
    "Page$",
    "Layout$",
    "Header$",
    "Footer$",
    "Sidebar$",
    "Section$",
    "Block$",
    "Container$",
    "Panel$",
  ],
  includeHtmlElements: false,
  includeHtmlTags: DEFAULT_INCLUDE_HTML_TAGS,
  maxDepth: 5,
};

export const DEFAULT_VISUALIZER_CONFIG: PageLogicVisualizerConfig = {
  ...DEFAULT_ANALYZER_CONFIG,
  appsDirs: ["apps/*"],
  rootDir: process.cwd(),
  tsConfigPath: "tsconfig.json",
  workspacePackageDirs: ["packages/*"],
};

export const mergeAnalyzerConfig = (
  overrides?: Partial<AnalyzerConfig>
): Required<AnalyzerConfig> => {
  const merged = { ...DEFAULT_ANALYZER_CONFIG };

  if (!overrides) {
    return merged;
  }

  for (const [key, value] of Object.entries(overrides) as [
    keyof AnalyzerConfig,
    AnalyzerConfig[keyof AnalyzerConfig],
  ][]) {
    if (value !== undefined) {
      merged[key] = value as never;
    }
  }

  return merged;
};
