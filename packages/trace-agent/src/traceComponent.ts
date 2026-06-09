import type { TraceDatabase } from "@ai-trace/cache";
import {
  findSymbolByName,
  getEdgesForSymbol,
  loadRoutes,
  loadSymbols,
} from "@ai-trace/cache";
import type { TraceResult } from "@ai-trace/types";

export function traceComponent(
  db: TraceDatabase,
  name: string
): TraceResult {
  const symbol = findSymbolByName(db, name, "component");

  if (!symbol) {
    throw new Error(`Component "${name}" not found. Run "ai-trace index" first.`);
  }

  const edges = getEdgesForSymbol(db, symbol.id);
  const allSymbols = loadSymbols(db);
  const routes = loadRoutes(db);

  const renders = edges
    .filter((e) => e.from === symbol.id && e.type === "renders")
    .map((e) => allSymbols.find((s) => s.id === e.to)?.name)
    .filter(Boolean) as string[];

  const hooks = edges
    .filter((e) => e.from === symbol.id && e.type === "uses_hook")
    .map((e) => allSymbols.find((s) => s.id === e.to)?.name)
    .filter(Boolean) as string[];

  const usedByFiles = edges
    .filter((e) => e.to === symbol.id)
    .map((e) => allSymbols.find((s) => s.id === e.from)?.filePath)
    .filter(Boolean) as string[];

  const usedByRoutes = routes
    .filter((r) => r.pageFile && usedByFiles.includes(r.pageFile))
    .map((r) => r.pageFile!);

  const relatedFiles = [
    symbol.filePath,
    ...usedByFiles,
    ...usedByRoutes,
  ].filter((v, i, arr) => arr.indexOf(v) === i);

  const steps = [
    `Entry: ${symbol.filePath}`,
    symbol.props?.length
      ? `Props: ${symbol.props.join(", ")}`
      : "Props: none",
    renders.length
      ? `Renders: ${renders.join(", ")}`
      : "Renders: none",
    hooks.length
      ? `Uses hooks: ${hooks.join(", ")}`
      : "Uses hooks: none",
    usedByRoutes.length
      ? `Used by routes: ${usedByRoutes.join(", ")}`
      : usedByFiles.length
        ? `Used by: ${usedByFiles.join(", ")}`
        : "Used by: unknown",
  ];

  return {
    id: `trace_${name}`,
    query: `Trace ${name}`,
    type: "component_trace",
    summary: `${name} is a component in ${symbol.filePath}.`,
    entryPoints: [symbol.filePath],
    relatedFiles,
    relatedSymbols: [symbol.id, ...renders, ...hooks],
    graph: {
      nodes: [
        {
          id: symbol.id,
          type: "component",
          label: symbol.name,
          filePath: symbol.filePath,
        },
      ],
      edges,
    },
    steps,
    warnings: [],
    createdAt: new Date().toISOString(),
  };
}

export function formatTraceResult(result: TraceResult): string {
  const lines = [result.query.replace("Trace ", ""), ""];

  for (const step of result.steps) {
    if (step.startsWith("Entry:")) {
      lines.push(` ├── file: ${step.replace("Entry: ", "")}`);
    } else if (step.startsWith("Props:")) {
      lines.push(` ├── props: ${step.replace("Props: ", "")}`);
    } else if (step.startsWith("Renders:")) {
      lines.push(` ├── renders: ${step.replace("Renders: ", "")}`);
    } else if (step.startsWith("Uses hooks:")) {
      lines.push(` ├── uses hooks: ${step.replace("Uses hooks: ", "")}`);
    } else if (step.startsWith("Used by")) {
      lines.push(` └── ${step.toLowerCase()}`);
    }
  }

  return lines.join("\n");
}
