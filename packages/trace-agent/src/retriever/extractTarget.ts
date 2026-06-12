import type { TraceIntent } from "@ai-trace/types";

export function extractTargetFromQuery(
  query: string,
  intent: TraceIntent
): string | undefined {
  if (intent === "component_trace") {
    const named = query.match(/component\s+([A-Za-z][\w]*)/i);
    if (named?.[1]) {
      return named[1];
    }
    const bare = query.trim().match(/^([A-Z][\w]*)$/);
    return bare?.[1];
  }

  if (intent === "hook_trace") {
    const named = query.match(/hook\s+(use[A-Za-z][\w]*)/i);
    if (named?.[1]) {
      return named[1];
    }
    const inline = query.match(/\b(use[A-Za-z][\w]*)\b/);
    return inline?.[1];
  }

  if (intent === "route_trace") {
    const quoted = query.match(/["']([^"']+)["']/);
    if (quoted?.[1]) {
      return quoted[1];
    }
    const path = query.match(/(\/[\w./[\]-]+)/);
    return path?.[1];
  }

  if (intent === "data_flow") {
    const quoted = query.match(/["']([^"']+)["']/);
    return quoted?.[1];
  }

  return undefined;
}
