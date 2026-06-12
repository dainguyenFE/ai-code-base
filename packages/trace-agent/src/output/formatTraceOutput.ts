import type { TraceResult, TraceResultSections } from "@ai-trace/types";

function printSection(title: string, lines: string[] | undefined): string[] {
  if (!lines || lines.length === 0) {
    return [];
  }

  return [title, ...lines.map((line) => `  ${line}`), ""];
}

export function formatTraceSections(
  name: string,
  sections: TraceResultSections,
  warnings: string[]
): string {
  const output: string[] = [name, ""];

  output.push(
    ...printSection("Entry", sections.entry),
    ...printSection("Boundary", sections.boundary),
    ...printSection("Render tree", sections.renderTree),
    ...printSection("Props passed", sections.propsPassed),
    ...printSection("Props received", sections.propsReceived),
    ...printSection("Prop origins", sections.propOrigins),
    ...printSection("Call chain", sections.callChain),
    ...printSection("Dynamic imports", sections.dynamicImports),
    ...printSection("Hooks", sections.hooks),
    ...printSection("Data / services", sections.data),
    ...printSection("Usage & impact", sections.usage),
    ...printSection("Route", sections.route),
    ...printSection("Layouts & segments", sections.layouts),
    ...printSection("Related", sections.related)
  );

  if (warnings.length > 0) {
    output.push("Warnings", ...warnings.map((warning) => `  - ${warning}`), "");
  }

  while (output.at(-1) === "") {
    output.pop();
  }

  return output.join("\n");
}

export function formatTraceResult(result: TraceResult): string {
  if (result.sections) {
    const title = result.query.replace(/^Trace (component |hook |route )?/, "");
    return formatTraceSections(title, result.sections, result.warnings);
  }

  return result.steps.join("\n");
}

export function formatRouteTrace(result: TraceResult): string {
  return formatTraceResult(result);
}

export function formatHookTrace(result: TraceResult): string {
  return formatTraceResult(result);
}
