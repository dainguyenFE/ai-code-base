import type { TraceDatabase } from "@ai-trace/cache";
import { loadRoutes, loadSymbols } from "@ai-trace/cache";
import type { TraceResult } from "@ai-trace/types";

export function traceRoute(db: TraceDatabase, routePath: string): TraceResult {
  const routes = loadRoutes(db);
  const route = routes.find((r) => r.path === routePath);

  if (!route) {
    throw new Error(
      `Route "${routePath}" not found. Run "ai-trace index" first.`
    );
  }

  const symbols = loadSymbols(db);
  const pageSymbols = route.pageFile
    ? symbols.filter((s) => s.filePath === route.pageFile)
    : [];

  const renders = pageSymbols.flatMap((s) => s.renders ?? []);

  const steps = [
    `Route: ${route.path}`,
    route.pageFile ? `Page: ${route.pageFile}` : "Page: none",
    route.layoutFiles.length
      ? `Layouts: ${route.layoutFiles.join(", ")}`
      : "Layouts: none",
    route.loadingFile ? `Loading: ${route.loadingFile}` : "",
    route.errorFile ? `Error: ${route.errorFile}` : "",
    renders.length ? `Renders: ${renders.join(", ")}` : "Renders: none",
  ].filter(Boolean);

  const relatedFiles = [
    route.pageFile,
    ...route.layoutFiles,
    route.loadingFile,
    route.errorFile,
    route.notFoundFile,
  ].filter((v): v is string => Boolean(v));

  return {
    id: `trace_route_${route.path}`,
    query: `Trace route ${route.path}`,
    type: "route_trace",
    summary: `Route ${route.path} maps to ${route.pageFile ?? "unknown page"}.`,
    entryPoints: route.pageFile ? [route.pageFile] : [],
    relatedFiles,
    relatedSymbols: renders,
    graph: { nodes: [], edges: [] },
    steps,
    warnings: [],
    createdAt: new Date().toISOString(),
  };
}

export function formatRouteTrace(result: TraceResult): string {
  return result.steps.map((step, index) => {
    const prefix =
      index === result.steps.length - 1 ? " └──" : " ├──";
    return `${prefix} ${step}`;
  }).join("\n");
}
