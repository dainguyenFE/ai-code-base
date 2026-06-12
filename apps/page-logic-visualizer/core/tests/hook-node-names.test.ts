import { describe, expect, it } from "bun:test";

import { analyzeComponentInFile } from "../src/analyzer/analyzeFile";
import { analyzeRoute } from "../src/analyzer/analyzeRoute";
import {
  buildHookTraceFromDataLocal,
  resolveHookNodeIdForLocal,
} from "../src/graph/hookTrace";
import { mergeGraphExpansion } from "../src/graph/mergeGraph";
import type { PageLogicGraph } from "../src/types";
import {
  graphNodeMatchesHookCallName,
  hookCallNameFromGraphNode,
} from "../src/utils/hookNodeNames";
import { resolveMonorepoRoot } from "./test-root";

const MONOREPO_ROOT = resolveMonorepoRoot();

describe("hookNodeNames", () => {
  it("extracts hook call name from store nodes", () => {
    const storeNode = {
      id: "store-1",
      label: "custom: useDemoUiStore",
      store: {
        callExpression: "useDemoUiStore()",
        library: "custom" as const,
        storeName: "demoUiStore",
      },
      type: "store" as const,
    };

    expect(hookCallNameFromGraphNode(storeNode)).toBe("useDemoUiStore");
    expect(graphNodeMatchesHookCallName(storeNode, "useDemoUiStore")).toBe(
      true
    );
    expect(graphNodeMatchesHookCallName(storeNode, "demoUiStore")).toBe(false);
  });
});

describe("resolveHookNodeIdForLocal", () => {
  it("matches store hook edges by call name", () => {
    const graph: PageLogicGraph = {
      edges: [
        {
          id: "edge-1",
          source: "component-1",
          target: "store-1",
          type: "uses-hook",
        },
      ],
      nodes: [
        {
          id: "component-1",
          label: "DemoHeader",
          type: "component",
        },
        {
          id: "store-1",
          importPath: "@/features/page-logic-demo/demoUiStore",
          label: "custom: useDemoUiStore",
          store: {
            callExpression: "useDemoUiStore()",
            importPath: "@/features/page-logic-demo/demoUiStore",
            library: "custom",
            outputNames: ["sidebarOpen", "setSidebarOpen"],
            storeName: "demoUiStore",
          },
          type: "store",
        },
      ],
    };

    expect(
      resolveHookNodeIdForLocal(graph, "component-1", "useDemoUiStore")
    ).toBe("store-1");
  });
});

describe("buildHookTraceFromDataLocal (integration)", () => {
  it("traces setSidebarOpen from useDemoUiStore on complex-pricing demo", () => {
    const graph = analyzeRoute({
      appDir: "apps/web",
      rootDir: MONOREPO_ROOT,
      route: "/_page-logic-visualizer-demo/complex-pricing",
    });
    if (!graph) {
      throw new Error("Failed to analyze complex-pricing route");
    }

    const anchor = graph.nodes.find(
      (node) => node.label === "DemoHeader" && node.id.includes("page:")
    );
    expect(anchor).toBeDefined();

    const expansion = analyzeComponentInFile({
      componentName: "DemoHeader",
      entryFile: "apps/web/src/features/page-logic-demo/DemoHeader.tsx",
      maxDepth: 6,
      rootDir: MONOREPO_ROOT,
    });

    const expandedGraph = mergeGraphExpansion({
      anchorNodeId: anchor!.id,
      base: graph,
      expansion,
    });

    const demoHeader = expandedGraph.nodes.find(
      (node) => node.id === anchor!.id
    );
    expect(
      demoHeader?.locals?.functions?.some((fn) => fn.name === "setSidebarOpen")
    ).toBe(true);

    const hookNodeId = resolveHookNodeIdForLocal(
      expandedGraph,
      anchor!.id,
      "useDemoUiStore"
    );
    expect(hookNodeId).toBeDefined();

    const trace = buildHookTraceFromDataLocal(
      expandedGraph,
      anchor!.id,
      "useDemoUiStore",
      { rootDir: MONOREPO_ROOT }
    );
    expect(trace).toBeDefined();
    expect(trace?.hookName).toBe("useDemoUiStore");
    expect(
      trace?.returnFields.some((field) => field.name === "setSidebarOpen")
    ).toBe(true);
  }, 15_000);
});
