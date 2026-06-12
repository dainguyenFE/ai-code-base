import type { TraceIntent } from "@ai-trace/types";

export function detectIntent(query: string): TraceIntent {
  const q = query.toLowerCase();

  if (q.includes("component")) {
    return "component_trace";
  }
  if (q.includes("hook")) {
    return "hook_trace";
  }
  if (q.includes("route")) {
    return "route_trace";
  }
  if (q.includes("data") || q.includes("flow")) {
    return "data_flow";
  }

  return "unknown";
}

export function intentFromTraceType(
  type: "component" | "hook" | "route"
): TraceIntent {
  if (type === "component") {
    return "component_trace";
  }
  if (type === "hook") {
    return "hook_trace";
  }
  return "route_trace";
}
