import path from "node:path";
import type { RouteInfo, ScannedFile } from "@ai-trace/types";

const ROUTE_FILES = {
  page: "page.tsx",
  layout: "layout.tsx",
  loading: "loading.tsx",
  error: "error.tsx",
  notFound: "not-found.tsx",
  route: "route.ts",
} as const;

function appDirToRoute(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, "/");
  if (!normalized.startsWith("app/")) return null;

  const parts = normalized.split("/");
  const fileName = parts.at(-1);
  if (!fileName || !Object.values(ROUTE_FILES).includes(fileName as never)) {
    return null;
  }

  const segments = parts.slice(1, -1).filter((segment) => {
    if (segment.startsWith("(") && segment.endsWith(")")) return false;
    if (segment.startsWith("@")) return false;
    return true;
  });

  const routeSegments = segments.map((segment) => {
    if (segment.startsWith("[[...") && segment.endsWith("]]")) {
      return `[[...${segment.slice(5, -2)}]]`;
    }
    if (segment.startsWith("[...") && segment.endsWith("]")) {
      return `[...${segment.slice(4, -1)}]`;
    }
    return segment;
  });

  return "/" + routeSegments.join("/");
}

export function detectRoutes(files: ScannedFile[]): RouteInfo[] {
  const routeMap = new Map<string, RouteInfo>();

  for (const file of files) {
    const routePath = appDirToRoute(file.path);
    if (!routePath) continue;

    const existing = routeMap.get(routePath) ?? {
      id: `route:${routePath}`,
      path: routePath,
      layoutFiles: [],
    };

    const fileName = path.basename(file.path);

    if (fileName === ROUTE_FILES.page) existing.pageFile = file.path;
    if (fileName === ROUTE_FILES.layout) existing.layoutFiles.push(file.path);
    if (fileName === ROUTE_FILES.loading) existing.loadingFile = file.path;
    if (fileName === ROUTE_FILES.error) existing.errorFile = file.path;
    if (fileName === ROUTE_FILES.notFound) existing.notFoundFile = file.path;
    if (fileName === ROUTE_FILES.route) existing.routeHandlerFile = file.path;

    routeMap.set(routePath, existing);
  }

  return [...routeMap.values()].sort((a, b) => a.path.localeCompare(b.path));
}
