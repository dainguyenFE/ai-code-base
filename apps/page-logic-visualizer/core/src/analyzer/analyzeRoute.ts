import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { GraphBuilder } from "../graph/createGraph";
import { mergeRouteChainGraph } from "../graph/mergeRouteChain";
import type {
  AnalyzeRouteOptions,
  PageLogicGraph,
  ResolvedRouteFile,
  ResolveRouteOptions,
} from "../types";
import { normalizePath, resolveFromRoot } from "../utils/path";
import { analyzePageFile } from "./analyzeFile";
import { buildLayoutTracesForRoute } from "./analyzeLayoutTrace";

const APP_DIR_CANDIDATES = ["src/app", "app"] as const;

/** Segments omitted from the public URL (route groups, private folders, slots). */
const isRoutelessSegment = (segment: string): boolean =>
  segment.startsWith("_") ||
  segment.startsWith("@") ||
  /^\(.+\)$/.test(segment);

const toPublicRoutePath = (relative: string): string => {
  if (relative.length === 0) {
    return "/";
  }
  const segments = relative
    .split(path.sep)
    .filter((segment) => !isRoutelessSegment(segment));
  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
};

const normalizeRouteInput = (route: string): string => {
  if (!route || route === "/") {
    return "/";
  }
  return route.startsWith("/") ? route : `/${route}`;
};

const resolveRouteToFileDirect = (
  options: ResolveRouteOptions
): ResolvedRouteFile | undefined => {
  const rootDir = options.rootDir ?? process.cwd();
  const appDir = resolveFromRoot(rootDir, options.appDir);
  const route = options.route === "/" ? "" : options.route.replace(/^\//, "");

  for (const appSubdir of APP_DIR_CANDIDATES) {
    const base = path.join(appDir, appSubdir, route);
    const pageFile = path.join(base, "page.tsx");
    if (existsSync(pageFile)) {
      const layouts = findLayoutChain(
        path.dirname(pageFile),
        path.join(appDir, appSubdir)
      );
      const relative = path.relative(
        path.join(appDir, appSubdir),
        path.dirname(pageFile)
      );
      return {
        layouts: layouts.map((layout) =>
          normalizePath(path.relative(rootDir, layout))
        ),
        pageFile: normalizePath(path.relative(rootDir, pageFile)),
        route:
          relative.length === 0
            ? normalizeRouteInput(options.route)
            : toPublicRoutePath(relative),
      };
    }
  }

  return undefined;
};

export const resolveRouteToFile = (
  options: ResolveRouteOptions
): ResolvedRouteFile | undefined => {
  const direct = resolveRouteToFileDirect(options);
  if (direct) {
    return direct;
  }

  const rootDir = options.rootDir ?? process.cwd();
  const routes = listAppRoutes(options.appDir, rootDir);
  const targetRoute = normalizeRouteInput(options.route);

  const byPublicRoute = routes.find((entry) => entry.route === targetRoute);
  if (byPublicRoute) {
    return byPublicRoute;
  }

  if (options.pageFile) {
    const normalizedPage = normalizePath(options.pageFile);
    return routes.find(
      (entry) => normalizePath(entry.pageFile) === normalizedPage
    );
  }

  return undefined;
};

const findLayoutChain = (segmentDir: string, appRoot: string): string[] => {
  const layouts: string[] = [];
  let current = segmentDir;

  while (current.startsWith(appRoot)) {
    const layoutFile = path.join(current, "layout.tsx");
    if (existsSync(layoutFile)) {
      layouts.unshift(layoutFile);
    }
    if (current === appRoot) {
      break;
    }
    current = path.dirname(current);
  }

  return layouts;
};

export const listAppRoutes = (
  appDir: string,
  rootDir: string = process.cwd()
): ResolvedRouteFile[] => {
  const absoluteAppDir = resolveFromRoot(rootDir, appDir);
  const routes: ResolvedRouteFile[] = [];

  for (const appSubdir of APP_DIR_CANDIDATES) {
    const appRoot = path.join(absoluteAppDir, appSubdir);
    if (!existsSync(appRoot)) {
      continue;
    }

    scanForPages(appRoot, appRoot, absoluteAppDir, rootDir, routes);
  }

  return routes.toSorted((a, b) => a.route.localeCompare(b.route));
};

const scanForPages = (
  currentDir: string,
  appRoot: string,
  absoluteAppDir: string,
  rootDir: string,
  routes: ResolvedRouteFile[]
): void => {
  const pageFile = path.join(currentDir, "page.tsx");
  if (existsSync(pageFile)) {
    const relative = path.relative(appRoot, currentDir);
    const route = toPublicRoutePath(relative);
    routes.push({
      layouts: findLayoutChain(currentDir, appRoot).map((layout) =>
        normalizePath(path.relative(rootDir, layout))
      ),
      pageFile: normalizePath(path.relative(rootDir, pageFile)),
      route,
    });
  }

  let entries: string[] = [];
  try {
    entries = readdirSync(currentDir);
  } catch {
    return;
  }

  for (const entry of entries) {
    const childDir = path.join(currentDir, entry);
    try {
      if (!statSync(childDir).isDirectory()) {
        continue;
      }
    } catch {
      continue;
    }
    scanForPages(childDir, appRoot, absoluteAppDir, rootDir, routes);
  }
};

const resolveLayoutChain = (
  resolved: ResolvedRouteFile,
  mode: AnalyzeRouteOptions["mode"],
  layoutFile?: string
): string[] => {
  if (mode === "page-only") {
    return [];
  }

  if (mode === "from-layout" && layoutFile) {
    const normalized = normalizePath(layoutFile);
    const index = resolved.layouts.findIndex(
      (layout) => normalizePath(layout) === normalized
    );
    if (index !== -1) {
      return resolved.layouts.slice(index);
    }
  }

  return resolved.layouts;
};

export const analyzeRoute = (options: AnalyzeRouteOptions): PageLogicGraph => {
  const mode = options.mode ?? "full";
  const resolved = resolveRouteToFile({
    appDir: options.appDir,
    pageFile: options.pageFile,
    rootDir: options.rootDir,
    route: options.route,
  });

  if (!resolved) {
    const graph = new GraphBuilder();
    graph.addWarning({
      code: "ROUTE_NOT_FOUND",
      message: `No page.tsx found for route ${options.route} in ${options.appDir}`,
    });
    return graph.toGraph("missing", options.route);
  }

  const analyzeOptions = {
    includeHtmlElements: options.includeHtmlElements ?? false,
    includeHtmlTags: options.includeHtmlTags,
    maxDepth: options.maxDepth,
    rootDir: options.rootDir,
    tsConfigPath: options.tsConfigPath,
  };

  const layoutFiles = resolveLayoutChain(resolved, mode, options.layoutFile);

  const layoutGraphs = layoutFiles.map((layoutFile) =>
    analyzePageFile({
      ...analyzeOptions,
      entryFile: layoutFile,
      rootType: "layout",
    })
  );

  const pageGraph = analyzePageFile({
    ...analyzeOptions,
    entryFile: resolved.pageFile,
    rootType: "page",
  });

  if (layoutGraphs.length === 0) {
    if (mode === "full") {
      const merged = mergeRouteChainGraph({
        layoutGraphs: [],
        pageGraph,
        route: resolved.route,
      });
      return {
        ...merged,
        layoutTraces: buildLayoutTracesForRoute(merged, {
          rootDir: options.rootDir,
          route: resolved.route,
          tsConfigPath: options.tsConfigPath,
        }),
      };
    }
    return pageGraph;
  }

  const merged = mergeRouteChainGraph({
    layoutGraphs,
    pageGraph,
    route: resolved.route,
  });

  return {
    ...merged,
    layoutTraces: buildLayoutTracesForRoute(merged, {
      rootDir: options.rootDir,
      route: resolved.route,
      tsConfigPath: options.tsConfigPath,
    }),
  };
};
