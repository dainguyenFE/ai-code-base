import path from "node:path";

import type { RouteInfo, ScannedFile } from "@ai-trace/types";

import { filePathToRoutePath } from "./routePath.js";

const ROUTE_FILE_MATCHERS = {
  error: /^error\.(tsx|ts|jsx|js)$/,
  layout: /^layout\.(tsx|ts|jsx|js)$/,
  loading: /^loading\.(tsx|ts|jsx|js)$/,
  notFound: /^not-found\.(tsx|ts|jsx|js)$/,
  page: /^page\.(tsx|ts|jsx|js)$/,
  route: /^route\.(ts|js)$/,
  template: /^template\.(tsx|ts|jsx|js)$/,
} as const;

export function detectRoutes(files: ScannedFile[]): RouteInfo[] {
  const routeMap = new Map<string, RouteInfo>();

  for (const file of files) {
    const routePath = filePathToRoutePath(file.path);
    if (!routePath) {
      continue;
    }

    const existing = routeMap.get(routePath) ?? {
      id: `route:${routePath}`,
      layoutFiles: [],
      path: routePath,
    };

    const fileName = path.basename(file.path);

    if (ROUTE_FILE_MATCHERS.page.test(fileName)) {
      existing.pageFile = file.path;
    }
    if (ROUTE_FILE_MATCHERS.layout.test(fileName)) {
      existing.layoutFiles.push(file.path);
    }
    if (ROUTE_FILE_MATCHERS.loading.test(fileName)) {
      existing.loadingFile = file.path;
    }
    if (ROUTE_FILE_MATCHERS.error.test(fileName)) {
      existing.errorFile = file.path;
    }
    if (ROUTE_FILE_MATCHERS.notFound.test(fileName)) {
      existing.notFoundFile = file.path;
    }
    if (ROUTE_FILE_MATCHERS.template.test(fileName)) {
      existing.templateFile = file.path;
    }
    if (ROUTE_FILE_MATCHERS.route.test(fileName)) {
      existing.routeHandlerFile = file.path;
    }

    routeMap.set(routePath, existing);
  }

  return [...routeMap.values()].toSorted((a: RouteInfo, b: RouteInfo) =>
    a.path.localeCompare(b.path)
  );
}
