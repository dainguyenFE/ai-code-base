const ROUTE_SEGMENT_FILES = new Set([
  "page.tsx",
  "page.ts",
  "page.jsx",
  "page.js",
  "layout.tsx",
  "layout.ts",
  "layout.jsx",
  "layout.js",
  "loading.tsx",
  "loading.ts",
  "error.tsx",
  "error.ts",
  "not-found.tsx",
  "not-found.ts",
  "route.ts",
  "route.js",
]);

function normalizeDynamicSegment(segment: string): string {
  if (segment.startsWith("[[...") && segment.endsWith("]]")) {
    return `[[...${segment.slice(5, -2)}]]`;
  }
  if (segment.startsWith("[...") && segment.endsWith("]")) {
    return `[...${segment.slice(4, -1)}]`;
  }
  return segment;
}

function isRoutableSegment(segment: string): boolean {
  if (segment.startsWith("(") && segment.endsWith(")")) {
    return false;
  }
  if (segment.startsWith("@")) {
    return false;
  }
  if (segment.startsWith("_")) {
    return false;
  }
  return true;
}

/** Map a scanned file path to an App Router URL path, if it is a route segment file. */
export function filePathToRoutePath(filePath: string): string | null {
  const normalized = filePath.replaceAll("\\", "/");
  const match = normalized.match(/(?:^|\/)(?:src\/)?app\/(.+)$/);
  if (!match) {
    return null;
  }

  const rest = match[1];
  const parts = rest.split("/");
  const fileName = parts.at(-1);
  if (!fileName || !ROUTE_SEGMENT_FILES.has(fileName)) {
    return null;
  }

  const segments = parts
    .slice(0, -1)
    .filter(isRoutableSegment)
    .map(normalizeDynamicSegment);

  return segments.length > 0 ? `/${segments.join("/")}` : "/";
}

export function isPageFile(filePath: string): boolean {
  const base = filePath.replaceAll("\\", "/").split("/").at(-1);
  return (
    base === "page.tsx" ||
    base === "page.ts" ||
    base === "page.jsx" ||
    base === "page.js"
  );
}

export function routePathsForFile(
  filePath: string,
  routePathByPageFile: Map<string, string>
): string[] {
  const paths = new Set<string>();
  const direct = routePathByPageFile.get(filePath);
  if (direct) {
    paths.add(direct);
  }

  const asRoute = filePathToRoutePath(filePath);
  if (asRoute) {
    paths.add(asRoute);
  }

  return [...paths].toSorted();
}
