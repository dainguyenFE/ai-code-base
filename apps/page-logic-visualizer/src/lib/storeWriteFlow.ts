import type {
  StoreFieldWriterTrace,
  StoreWriteSite,
} from "@cs/page-logic-visualizer/client";

import type { PropFlowNode } from "@/lib/propFlowGraph";
import type { UsageFlowBranch, UsageFlowGraph } from "@/lib/propUsageFlow";

const contextLabel = (site: StoreWriteSite): string => {
  switch (site.context) {
    case "effect": {
      return "updates (effect)";
    }
    case "event-handler": {
      return "updates (handler)";
    }
    case "effect-deps": {
      return "triggers reload";
    }
    default: {
      return "updates";
    }
  }
};

const siteToFlowNode = (site: StoreWriteSite, index: number): PropFlowNode => ({
  detail: site.expression,
  id: `store-writer:${site.filePath}:${site.loc?.startLine ?? index}:${site.context}`,
  label: site.ownerLabel,
  loc: site.loc,
  narrative: contextLabel(site),
  stepRole:
    site.context === "effect-deps"
      ? "effect-deps"
      : site.context === "event-handler"
        ? "handler"
        : site.context === "effect"
          ? "effect"
          : "call",
});

/** Fan-in graph: writers / reactive triggers → store field (page-scoped). */
export const buildStoreWriterUsageGraph = (
  trace: StoreFieldWriterTrace,
  storeHook?: string
): UsageFlowGraph => {
  const intake: PropFlowNode = {
    detail: storeHook
      ? `{ ${trace.storeField} } ← ${storeHook}()`
      : trace.storeField,
    id: `store-field:${trace.storeField}`,
    label: trace.storeField,
    narrative: storeHook ?? "store field",
    stepRole: "store-field",
  };

  const branches: UsageFlowBranch[] = [];

  for (const [index, site] of trace.writers.entries()) {
    branches.push({
      edgeLabel: "updates",
      node: siteToFlowNode(site, index),
    });
  }

  for (const [index, site] of trace.reactiveTriggers.entries()) {
    branches.push({
      edgeLabel: "depends on",
      node: siteToFlowNode(site, trace.writers.length + index),
    });
  }

  return { branches, intake };
};
