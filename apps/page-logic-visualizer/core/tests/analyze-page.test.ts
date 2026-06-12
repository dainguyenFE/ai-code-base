import { describe, expect, test } from "bun:test";

import {
  buildPropExecutionFlowGraph,
  buildLinearPropFlowGraph,
} from "../src/graph/propExecutionFlow";
import { buildVariableUsages } from "../src/graph/variableTrace";
import {
  analyzeComponentInFile,
  analyzePageFile,
  analyzeRoute,
  buildAllTraceLayers,
  buildDataTraceChain,
  buildEventActionTrace,
  buildFocusDiagram,
  buildHookTraceFromDataLocal,
  buildHookTraceFromEffectLocal,
  buildHookTraceView,
  buildNodeContext,
  buildStateStoreTrace,
  buildTraceStepGroups,
  buildUiTree,
  flattenUiTree,
  listAppRoutes,
  mergeGraphExpansion,
  resolveCallSitePropExpression,
  resolveImmediatePropExpression,
  resolveImmediatePropLoc,
  resolvePropDataExpression,
  resolveExpressionToNode,
  searchGraph,
} from "../src/index";
import { resolveMonorepoRoot } from "./test-root";

const ROOT_DIR = resolveMonorepoRoot();

describe("analyzePageFile", () => {
  test("analyzes creative-studio home page", () => {
    const graph = analyzePageFile({
      entryFile: "apps/creative-studio/src/app/page.tsx",
      maxDepth: 8,
      rootDir: ROOT_DIR,
    });

    expect(graph.rootNodeId).toContain("page");
    expect(graph.nodes.length).toBeGreaterThan(0);

    const pageNode = graph.nodes.find((node) => node.type === "page");
    expect(pageNode).toBeDefined();

    const dataFetchNodes = graph.nodes.filter(
      (node) => node.type === "data-fetch"
    );
    expect(
      dataFetchNodes.some((node) => node.dataFetch?.functionName === "cookies")
    ).toBe(true);

    const componentNodes = graph.nodes.filter(
      (node) => node.type === "component"
    );
    expect(componentNodes.some((node) => node.label === "JsonLdScript")).toBe(
      true
    );
    expect(componentNodes.some((node) => node.label === "Button")).toBe(true);
    expect(componentNodes.some((node) => node.packageName === "@cs/seo")).toBe(
      true
    );
  });

  test("analyzes web home page with workspace imports", () => {
    const graph = analyzePageFile({
      entryFile: "apps/web/src/app/page.tsx",
      maxDepth: 3,
      rootDir: ROOT_DIR,
    });

    const components = graph.nodes.filter((node) => node.type === "component");
    expect(components.some((node) => node.label === "Button")).toBe(true);
    expect(components.some((node) => node.label === "HomeIcon")).toBe(true);
  });

  test("returns warning for missing file", () => {
    const graph = analyzePageFile({
      entryFile: "apps/web/src/app/does-not-exist/page.tsx",
      rootDir: ROOT_DIR,
    });

    expect(
      graph.warnings.some((warning) => warning.code === "FILE_NOT_FOUND")
    ).toBe(true);
  });
});

describe("hook analysis", () => {
  test("detects nested hooks in PricingInteractiveSection", () => {
    const graph = analyzeComponentInFile({
      componentName: "PricingInteractiveSection",
      entryFile:
        "apps/web/src/features/page-logic-demo/PricingInteractiveSection.tsx",
      maxDepth: 8,
      rootDir: ROOT_DIR,
    });

    expect(graph.nodes.some((node) => node.type === "context")).toBe(true);
    expect(graph.nodes.some((node) => node.type === "store")).toBe(true);

    const hooks = graph.nodes.filter((node) => node.type === "hook");
    expect(hooks.some((node) => node.label === "useDemoPageViewModel")).toBe(
      true
    );

    const viewModel = hooks.find(
      (node) => node.label === "useDemoPageViewModel"
    );
    expect(viewModel?.hook?.inputs.length).toBeGreaterThan(0);
    expect(viewModel?.hook?.outputs.length).toBeGreaterThan(0);
    expect(viewModel?.hook?.nestedHooks?.length).toBeGreaterThan(0);

    const interactive = graph.nodes.find(
      (node) => node.label === "PricingInteractiveSection"
    );
    expect(interactive).toBeDefined();

    const promoChain = buildDataTraceChain(
      graph,
      "showPromoBanner",
      interactive!.id
    );
    expect(
      promoChain.steps.some((step) => step.label === "showPromoBanner")
    ).toBe(true);
    expect(
      promoChain.steps.some((step) =>
        step.label.includes("useDemoPageViewModel")
      )
    ).toBe(true);
    expect(
      promoChain.steps.some((step) =>
        step.label.includes("usePromoEligibility")
      )
    ).toBe(true);
    expect(
      promoChain.steps.some((step) => step.label.includes("useAuthState"))
    ).toBe(true);
  });

  test("complex pricing demo page includes data-fetch and conditions", () => {
    const graph = analyzePageFile({
      entryFile:
        "apps/web/src/app/_page-logic-visualizer-demo/complex-pricing/page.tsx",
      maxDepth: 8,
      rootDir: ROOT_DIR,
    });

    expect(
      graph.nodes.some((node) => node.label === "PricingInteractiveSection")
    ).toBe(true);
    expect(graph.nodes.some((node) => node.type === "condition")).toBe(true);
    expect(graph.nodes.some((node) => node.type === "data-fetch")).toBe(true);
  });
});

describe("trace IO", () => {
  test("builds focus diagram with hook and data upstream", () => {
    const graph = analyzeComponentInFile({
      componentName: "PricingInteractiveSection",
      entryFile:
        "apps/web/src/features/page-logic-demo/PricingInteractiveSection.tsx",
      maxDepth: 8,
      rootDir: ROOT_DIR,
    });

    const root = graph.nodes.find(
      (node) => node.label === "PricingInteractiveSection"
    );
    expect(root).toBeDefined();

    const diagram = buildFocusDiagram(graph, root!.id);
    const stepGroups = buildTraceStepGroups(diagram);
    expect(diagram.steps.some((step) => step.node.type === "hook")).toBe(true);
    expect(stepGroups.some((group) => group.kind === "logic")).toBe(true);
    expect(stepGroups.find((group) => group.kind === "focus")).toBeDefined();

    const context = buildNodeContext(graph, root!.id);
    expect(context?.rendersOut.length).toBeGreaterThan(0);
  });

  test("resolves data.plans to data-fetch on demo page", () => {
    const graph = analyzePageFile({
      entryFile:
        "apps/web/src/app/_page-logic-visualizer-demo/complex-pricing/page.tsx",
      maxDepth: 8,
      rootDir: ROOT_DIR,
    });

    const dataNode = resolveExpressionToNode(graph, "data.plans");
    expect(dataNode?.type).toBe("data-fetch");
  });
});

describe("ui graph", () => {
  test("builds UI card tree from route with layouts", () => {
    const graph = analyzeRoute({
      appDir: "apps/web",
      maxDepth: 8,
      rootDir: ROOT_DIR,
      route: "/_page-logic-visualizer-demo/complex-pricing",
    });

    const tree = buildUiTree(graph);
    expect(tree?.node.type).toBe("route");
    expect(tree?.children.length).toBeGreaterThan(0);

    const flat = (node: NonNullable<typeof tree>): string[] => [
      node.node.label,
      ...node.children.flatMap((child) => flat(child)),
    ];
    const labels = flat(tree!);
    expect(labels.some((label) => label.includes("Layout"))).toBe(true);

    const demoLayout = tree?.children[0]?.children.find(
      (child) => child.node.label === "PageLogicDemoLayout"
    );
    expect(demoLayout).toBeDefined();
    expect(
      demoLayout!.children.some(
        (child) => child.node.label === "ComplexPricingDemoPage"
      )
    ).toBe(false);

    const themeProvider = demoLayout?.children.find(
      (child) => child.node.label === "DemoThemeProvider"
    );
    expect(
      themeProvider?.children.some(
        (child) => child.node.label === "ComplexPricingDemoPage"
      )
    ).toBe(true);
  });

  test("data chips use variable names not function names", () => {
    const graph = analyzeRoute({
      appDir: "apps/web",
      maxDepth: 8,
      rootDir: ROOT_DIR,
      route: "/_page-logic-visualizer-demo/complex-pricing",
    });

    const tree = buildUiTree(graph);
    const findPage = (
      node: NonNullable<typeof tree>
    ): NonNullable<typeof tree> | undefined => {
      if (node.node.label === "ComplexPricingDemoPage") {
        return node;
      }
      for (const child of node.children) {
        const found = findPage(child);
        if (found) {
          return found;
        }
      }
      return undefined;
    };

    const page = tree ? findPage(tree) : undefined;
    expect(page?.dataUsed.some((item) => item.name === "data")).toBe(true);
    expect(page?.dataUsed.some((item) => item.name === "cookieStore")).toBe(
      true
    );
    expect(page?.dataUsed.some((item) => item.name === "getDemoPageData")).toBe(
      false
    );
  });

  test("page locals split into props, variables, functions, hooks", () => {
    const graph = analyzeRoute({
      appDir: "apps/web",
      maxDepth: 8,
      rootDir: ROOT_DIR,
      route: "/_page-logic-visualizer-demo/complex-pricing",
    });

    const tree = buildUiTree(graph);
    const findPage = (
      node: NonNullable<typeof tree>
    ): NonNullable<typeof tree> | undefined => {
      if (node.node.label === "ComplexPricingDemoPage") {
        return node;
      }
      for (const child of node.children) {
        const found = findPage(child);
        if (found) {
          return found;
        }
      }
      return undefined;
    };

    const page = tree ? findPage(tree) : undefined;
    expect(page).toBeDefined();
    expect(page!.locals.props.map((item) => item.name)).toEqual([]);
    expect(page!.locals.variables.map((item) => item.name)).toEqual([
      "cookieStore",
      "data",
      "previewMode",
      "showGraduationPromo",
    ]);
    expect(page!.locals.functions.map((item) => item.name)).toEqual([]);
    expect(page!.locals.hooks.map((item) => item.name)).toEqual([]);

    const pageNode = graph.nodes.find(
      (node) => node.label === "ComplexPricingDemoPage"
    );
    expect(pageNode?.locals?.variables.map((item) => item.name)).toEqual([
      "cookieStore",
      "data",
      "previewMode",
      "showGraduationPromo",
    ]);
  });

  test("DemoHeader shows JSX props isLoggedIn before expand", () => {
    const graph = analyzeRoute({
      appDir: "apps/web",
      maxDepth: 8,
      rootDir: ROOT_DIR,
      route: "/_page-logic-visualizer-demo/complex-pricing",
    });

    const tree = buildUiTree(graph);
    const findPage = (
      node: NonNullable<typeof tree>
    ): NonNullable<typeof tree> | undefined => {
      if (node.node.label === "ComplexPricingDemoPage") {
        return node;
      }
      for (const child of node.children) {
        const found = findPage(child);
        if (found) {
          return found;
        }
      }
      return undefined;
    };

    const page = tree ? findPage(tree) : undefined;
    const header = page?.children.find(
      (child) => child.node.label === "DemoHeader"
    );
    expect(header).toBeDefined();
    expect(header!.locals.props.map((item) => item.name)).toContain(
      "isLoggedIn"
    );
    expect(
      header!.locals.props.find((item) => item.name === "isLoggedIn")
        ?.expression
    ).toBe("data.isLoggedIn");
  });

  test("builds focused data trace chain for variable and hardcoded field", () => {
    const graph = analyzeRoute({
      appDir: "apps/web",
      maxDepth: 8,
      rootDir: ROOT_DIR,
      route: "/_page-logic-visualizer-demo/complex-pricing",
    });

    const tree = buildUiTree(graph);
    const findPage = (
      node: NonNullable<typeof tree>
    ): NonNullable<typeof tree> | undefined => {
      if (node.node.label === "ComplexPricingDemoPage") {
        return node;
      }
      for (const child of node.children) {
        const found = findPage(child);
        if (found) {
          return found;
        }
      }
      return undefined;
    };

    const page = tree ? findPage(tree) : undefined;
    expect(page).toBeDefined();

    const dataFetch = graph.nodes.find(
      (node) =>
        node.type === "data-fetch" &&
        node.dataFetch?.functionName === "getDemoPageData"
    );
    expect(dataFetch?.dataFetch?.returnFieldLiterals?.isLoggedIn?.value).toBe(
      "false"
    );
    expect(
      dataFetch?.dataFetch?.returnFieldLiterals?.isLoggedIn?.loc?.startLine
    ).toBe(84);

    const dataChain = buildDataTraceChain(graph, "data", page!.nodeId, tree);
    expect(dataChain.steps.some((step) => step.label === "data")).toBe(true);
    expect(
      dataChain.steps.some((step) => step.label.includes("getDemoPageData"))
    ).toBe(true);
    expect(
      dataChain.steps.some((step) => step.stepRole === "internal-call")
    ).toBe(true);
    expect(dataChain.consumerLabel).toBe("ComplexPricingDemoPage");
    expect(dataChain.steps.some((step) => step.stepRole === "consumer")).toBe(
      false
    );
    expect(
      dataChain.steps.every((step) => !step.label.includes("Layout"))
    ).toBe(true);

    const loggedInChain = buildDataTraceChain(
      graph,
      "data.isLoggedIn",
      page!.nodeId,
      tree
    );
    expect(loggedInChain.steps.some((step) => step.label === "false")).toBe(
      true
    );
    const literalStep = loggedInChain.steps.find(
      (step) => step.stepRole === "literal"
    );
    expect(literalStep?.loc?.filePath).toContain("getDemoPageData.ts");
    expect(literalStep?.loc?.startLine).toBe(84);
  });

  test("PricingInteractiveSection props trace through data-fetch after expand", () => {
    const base = analyzeRoute({
      appDir: "apps/web",
      maxDepth: 8,
      rootDir: ROOT_DIR,
      route: "/_page-logic-visualizer-demo/complex-pricing",
    });

    const pis = base.nodes.find(
      (node) => node.label === "PricingInteractiveSection"
    );
    expect(pis).toBeDefined();

    const expansion = analyzeComponentInFile({
      componentName: "PricingInteractiveSection",
      entryFile:
        "apps/web/src/features/page-logic-demo/PricingInteractiveSection.tsx",
      maxDepth: 8,
      rootDir: ROOT_DIR,
    });
    const merged = mergeGraphExpansion({
      anchorNodeId: pis!.id,
      base,
      expansion,
    });
    const tree = buildUiTree(merged);
    const pisTree = flattenUiTree(tree).find(
      (node) => node.node.label === "PricingInteractiveSection"
    );
    expect(pisTree).toBeDefined();
    expect(pisTree!.locals.hooks.map((item) => item.name)).toEqual([]);
    expect(pisTree!.locals.variables.map((item) => item.name)).toEqual(
      expect.arrayContaining([
        "accent",
        "faqCount",
        "filteredFaqs",
        "promoText",
        "selectedPlan",
        "sessionLabel",
        "showPromoBanner",
        "sidebarOpen",
        "themeName",
      ])
    );
    expect(pisTree!.locals.functions.map((item) => item.name)).toEqual(
      expect.arrayContaining(["selectPlan", "setFaqQuery"])
    );

    for (const [propName, callSite] of [
      ["plans", "data.plans"],
      ["faqs", "data.faqs"],
      ["isLoggedIn", "data.isLoggedIn"],
    ] as const) {
      expect(resolveCallSitePropExpression(merged, pis!.id, propName)).toBe(
        callSite
      );

      const chain = buildDataTraceChain(merged, propName, pis!.id, tree, {
        propName,
      });
      expect(chain.steps.map((step) => step.label).slice(0, 3)).toEqual([
        propName,
        "data",
        "fetchDemoPageData()",
      ]);
      expect(chain.steps[0]?.stepRole).toBe("prop");
      expect(chain.steps[0]?.loc?.filePath).toContain(
        "complex-pricing/page.tsx"
      );
      if (propName === "isLoggedIn") {
        expect(chain.steps.some((step) => step.stepRole === "hardcode")).toBe(
          true
        );
      }
    }
  });

  test("execution flow graph models try/catch and nested await for plans prop", () => {
    const graph = analyzeRoute({
      appDir: "apps/web",
      maxDepth: 8,
      rootDir: ROOT_DIR,
      route: "/_page-logic-visualizer-demo/complex-pricing",
    });

    const tree = buildUiTree(graph);
    const pis = flattenUiTree(tree).find(
      (node) => node.node.label === "PricingInteractiveSection"
    );
    expect(pis).toBeDefined();

    const chain = buildDataTraceChain(graph, "plans", pis!.nodeId, tree, {
      propName: "plans",
    });

    const fetchNode = graph.nodes.find(
      (node) => node.dataFetch?.functionName === "fetchDemoPageData"
    );
    expect(fetchNode?.dataFetch?.executionFlow?.length).toBeGreaterThan(0);

    const tryCatch = fetchNode!.dataFetch!.executionFlow!.find(
      (step) =>
        step.kind === "branch" &&
        step.branches?.some((b) => b.branchKind === "try")
    );
    expect(tryCatch).toBeDefined();
    const catchBranch = tryCatch!.branches!.find(
      (b) => b.branchKind === "catch"
    );
    expect(
      catchBranch?.propOutcome ?? catchBranch?.steps.some((s) => s.propOutcome)
    ).toBeTruthy();

    const flowGraph = buildLinearPropFlowGraph(graph, chain, {
      fieldPath: "plans",
    });

    expect(flowGraph.some((node) => node.stepRole === "await-call")).toBe(true);
    expect(
      flowGraph.some((node) =>
        node.branchGroup?.branches.some((b) => b.branchKind === "catch")
      )
    ).toBe(true);
    expect(flowGraph.some((node) => node.stepRole === "resume")).toBe(true);
  });

  test("linear prop flow omits catch literal until function body is expanded", () => {
    const graph = analyzeRoute({
      appDir: "apps/web",
      maxDepth: 8,
      rootDir: ROOT_DIR,
      route: "/_page-logic-visualizer-demo/complex-pricing",
    });

    const tree = buildUiTree(graph);
    const hero = flattenUiTree(tree).find(
      (node) => node.node.label === "DemoHero"
    );
    expect(hero).toBeDefined();

    const flowGraph = buildLinearPropFlowGraph(
      graph,
      buildDataTraceChain(graph, "data.hero.badge", hero!.nodeId, tree, {
        propName: "badge",
      }),
      { fieldPath: "hero.badge" }
    );

    expect(flowGraph.map((node) => node.label)).toEqual([
      "badge",
      "data",
      "fetchDemoPageData()",
    ]);

    const fetchNode = flowGraph.find((node) => node.stepRole === "await-call");
    const catchBranch =
      fetchNode?.expandableSteps?.[0]?.branchGroup?.branches.find(
        (branch) => branch.branchKind === "catch"
      );
    expect(catchBranch?.steps.some((step) => step.stepRole === "literal")).toBe(
      true
    );
  });

  test("catch-block literal trace links to source for DemoHero props", () => {
    const graph = analyzeRoute({
      appDir: "apps/web",
      maxDepth: 8,
      rootDir: ROOT_DIR,
      route: "/_page-logic-visualizer-demo/complex-pricing",
    });

    const tree = buildUiTree(graph);
    const hero = flattenUiTree(tree).find(
      (node) => node.node.label === "DemoHero"
    );
    expect(hero).toBeDefined();

    for (const [propName, fieldPath, expectedLine] of [
      ["badge", "hero.badge", 80],
      ["subtitle", "hero.subtitle", 81],
    ] as const) {
      const chain = buildDataTraceChain(
        graph,
        `data.${fieldPath}`,
        hero!.nodeId,
        tree,
        { propName }
      );
      const literalStep = chain.steps.find(
        (step) => step.stepRole === "literal"
      );
      expect(literalStep).toBeDefined();
      expect(literalStep?.detail).toBe(
        `${propName}: ${literalStep?.label ?? ""}`
      );
      expect(literalStep?.loc?.filePath).toContain("getDemoPageData.ts");
      expect(literalStep?.loc?.startLine).toBe(expectedLine);
    }
  });

  test("traces JSX prop through module binding and return type", () => {
    const graph = analyzeRoute({
      appDir: "apps/web",
      maxDepth: 8,
      rootDir: ROOT_DIR,
      route: "/_page-logic-visualizer-demo/complex-pricing",
    });

    const tree = buildUiTree(graph);
    const flat = flattenUiTree(tree);
    const jsonLd = flat.find((node) => node.node.label === "JsonLdScript");
    expect(jsonLd).toBeDefined();

    const chain = buildDataTraceChain(
      graph,
      "pageGraph",
      jsonLd!.nodeId,
      tree,
      { propName: "data" }
    );

    expect(chain.steps[0]?.label).toBe("data");
    expect(chain.steps[0]?.stepRole).toBe("prop");
    expect(chain.steps.some((step) => step.label === "pageGraph")).toBe(true);
    expect(
      chain.steps.some(
        (step) =>
          step.label === "withSchemaContext()" &&
          step.detail?.includes("JsonLd")
      )
    ).toBe(true);
    const schemaStep = chain.steps.find(
      (step) => step.label === "withSchemaContext()"
    );
    expect(
      schemaStep?.children?.some(
        (child) => child.label === "buildWebPageSchema()"
      )
    ).toBe(true);
    expect(
      schemaStep?.children?.some(
        (child) => child.label === "buildBreadcrumbSchema()"
      )
    ).toBe(true);
  });

  test("skips plain HTML wrapper nodes in UI tree", () => {
    const graph = analyzeRoute({
      appDir: "apps/web",
      maxDepth: 8,
      rootDir: ROOT_DIR,
      route: "/_page-logic-visualizer-demo/complex-pricing",
    });

    const tree = buildUiTree(graph);
    const flat = flattenUiTree(tree);
    expect(flat.some((node) => node.node.label.startsWith("<"))).toBe(false);
    expect(flat.some((node) => node.node.label === "DemoHero")).toBe(true);
    expect(flat.some((node) => node.node.label === "PricingLiveSection")).toBe(
      true
    );
  });
});

describe("if-return gate inference", () => {
  test("hasPlans traces local variable through plans prop to data-fetch", () => {
    const graph = analyzeRoute({
      appDir: "apps/web",
      maxDepth: 8,
      rootDir: ROOT_DIR,
      route: "/_page-logic-visualizer-demo/complex-pricing",
    });

    const tree = buildUiTree(graph);
    const plansBlock = flattenUiTree(tree).find(
      (node) => node.node.label === "PlansBlock"
    );
    expect(plansBlock).toBeDefined();
    expect(
      plansBlock!.locals.variables.some((item) => item.name === "hasPlans")
    ).toBe(true);

    const chain = buildDataTraceChain(
      graph,
      "hasPlans",
      plansBlock!.nodeId,
      tree
    );
    expect(chain.steps.map((step) => step.label)).toEqual([
      "hasPlans",
      "plans",
      "data",
      "fetchDemoPageData()",
    ]);
    expect(chain.steps[0]?.loc?.startLine).toBe(75);

    const flowGraph = buildLinearPropFlowGraph(graph, chain, {
      fieldPath: "plans",
    });
    expect(flowGraph.some((node) => node.stepRole === "await-call")).toBe(true);
    expect(flowGraph.some((node) => node.label === "hasPlans")).toBe(true);

    const usages = buildVariableUsages(graph, plansBlock!.nodeId, "hasPlans", {
      rootDir: ROOT_DIR,
    });
    expect(usages.length).toBeGreaterThan(0);
    expect(
      usages.some(
        (usage) =>
          usage.kind === "condition" ||
          usage.label.includes("hasPlans") ||
          usage.code?.includes("hasPlans")
      )
    ).toBe(true);
  });

  test("PlansBlock gates EmptyPlans and PlanSection from early return", () => {
    const graph = analyzeComponentInFile({
      componentName: "PlansBlock",
      entryFile:
        "apps/web/src/app/_page-logic-visualizer-demo/complex-pricing/page.tsx",
      maxDepth: 8,
      rootDir: ROOT_DIR,
    });

    const uiTree = buildUiTree(graph);
    expect(uiTree).not.toBeNull();

    const nodes = flattenUiTree(uiTree);
    const emptyPlans = nodes.find((node) => node.node.label === "EmptyPlans");
    const planSection = nodes.find((node) => node.node.label === "PlanSection");

    expect(emptyPlans).toBeDefined();
    expect(planSection).toBeDefined();

    expect(emptyPlans?.gateConditions).toEqual([
      expect.objectContaining({
        branch: "true",
        expression: "!hasPlans",
        inputs: ["hasPlans"],
      }),
    ]);
    expect(planSection?.gateConditions).toEqual([
      expect.objectContaining({
        branch: "false",
        expression: "!hasPlans",
        inputs: ["hasPlans"],
      }),
    ]);

    const ifReturnConditions = graph.nodes.filter(
      (node) =>
        node.type === "condition" && node.condition?.kind === "if-return"
    );
    expect(ifReturnConditions).toHaveLength(1);
    expect(ifReturnConditions[0]?.condition?.expression).toBe("!hasPlans");
  });

  test("PlansBlock shallow preview exposes PlanSection before expand", () => {
    const graph = analyzeRoute({
      appDir: "apps/web",
      maxDepth: 8,
      rootDir: ROOT_DIR,
      route: "/_page-logic-visualizer-demo/complex-pricing",
    });

    const tree = buildUiTree(graph);
    const plansBlock = flattenUiTree(tree).find(
      (node) => node.node.label === "PlansBlock"
    );
    expect(plansBlock).toBeDefined();
    expect(plansBlock!.children.map((child) => child.node.label)).toEqual(
      expect.arrayContaining(["EmptyPlans", "PlanSection"])
    );

    const planSection = plansBlock!.children.find(
      (child) => child.node.label === "PlanSection"
    );
    expect(planSection?.node.metadata?.shallowPreview).toBe(true);
    expect(
      planSection?.children.some((child) => child.node.label === "PlanCard")
    ).toBe(true);
  });

  test("PlanSection and PlansBlock plans prop use distinct call-site locations", () => {
    const base = analyzeRoute({
      appDir: "apps/web",
      maxDepth: 8,
      rootDir: ROOT_DIR,
      route: "/_page-logic-visualizer-demo/complex-pricing",
    });

    const plansBlockNode = base.nodes.find(
      (node) => node.label === "PlansBlock"
    );
    expect(plansBlockNode).toBeDefined();

    const plansBlockExpansion = analyzeComponentInFile({
      componentName: "PlansBlock",
      entryFile:
        "apps/web/src/app/_page-logic-visualizer-demo/complex-pricing/page.tsx",
      maxDepth: 8,
      rootDir: ROOT_DIR,
    });
    const merged = mergeGraphExpansion({
      anchorNodeId: plansBlockNode!.id,
      base,
      expansion: plansBlockExpansion,
    });
    const tree = buildUiTree(merged);

    const plansBlock = flattenUiTree(tree).find(
      (node) => node.node.label === "PlansBlock"
    );
    const planSection = flattenUiTree(tree).find(
      (node) => node.node.label === "PlanSection"
    );
    expect(plansBlock).toBeDefined();
    expect(planSection).toBeDefined();

    expect(resolvePropDataExpression(merged, plansBlock!.nodeId, "plans")).toBe(
      "data.plans"
    );
    expect(
      resolvePropDataExpression(merged, planSection!.nodeId, "plans")
    ).toBe("data.plans");
    expect(
      resolveImmediatePropExpression(merged, planSection!.nodeId, "plans")
    ).toBe("plans");

    const plansBlockChain = buildDataTraceChain(
      merged,
      "plans",
      plansBlock!.nodeId,
      tree,
      { propName: "plans" }
    );
    const planSectionChain = buildDataTraceChain(
      merged,
      "plans",
      planSection!.nodeId,
      tree,
      { propName: "plans" }
    );

    expect(plansBlockChain.steps[0]?.stepRole).toBe("prop");
    expect(planSectionChain.steps[0]?.stepRole).toBe("prop");
    expect(planSectionChain.steps[1]?.stepRole).toBe("prop");
    expect(plansBlockChain.steps[0]?.loc?.startLine).toBe(129);
    expect(planSectionChain.steps[0]?.loc?.startLine).toBe(81);
    expect(planSectionChain.steps[1]?.loc?.startLine).toBe(129);
    expect(planSectionChain.steps.map((step) => step.label)).toEqual([
      "plans",
      "plans",
      "data",
      "fetchDemoPageData()",
    ]);
    expect(plansBlockChain.steps[0]?.loc?.filePath).toContain(
      "complex-pricing/page.tsx"
    );
    expect(planSectionChain.steps[0]?.loc?.filePath).toContain(
      "complex-pricing/page.tsx"
    );
  });

  test("PlanCard plan prop uses PlanSection call site after expand", () => {
    const base = analyzeRoute({
      appDir: "apps/web",
      maxDepth: 8,
      rootDir: ROOT_DIR,
      route: "/_page-logic-visualizer-demo/complex-pricing",
    });

    const plansBlockNode = base.nodes.find(
      (node) => node.label === "PlansBlock"
    );
    expect(plansBlockNode).toBeDefined();

    const plansBlockExpansion = analyzeComponentInFile({
      componentName: "PlansBlock",
      entryFile:
        "apps/web/src/app/_page-logic-visualizer-demo/complex-pricing/page.tsx",
      maxDepth: 8,
      rootDir: ROOT_DIR,
    });
    const withPlansBlock = mergeGraphExpansion({
      anchorNodeId: plansBlockNode!.id,
      base,
      expansion: plansBlockExpansion,
    });

    const planSectionNode = withPlansBlock.nodes.find(
      (node) => node.label === "PlanSection"
    );
    expect(planSectionNode).toBeDefined();

    const planSectionExpansion = analyzeComponentInFile({
      componentName: "PlanSection",
      entryFile: "apps/web/src/features/page-logic-demo/PlanSection.tsx",
      maxDepth: 8,
      rootDir: ROOT_DIR,
    });
    const merged = mergeGraphExpansion({
      anchorNodeId: planSectionNode!.id,
      base: withPlansBlock,
      expansion: planSectionExpansion,
    });
    const tree = buildUiTree(merged);

    const planCard = flattenUiTree(tree).find(
      (node) => node.node.label === "PlanCard"
    );
    expect(planCard).toBeDefined();
    expect(
      resolveImmediatePropExpression(merged, planCard!.nodeId, "plan")
    ).toBe("plan");

    const chain = buildDataTraceChain(merged, "plan", planCard!.nodeId, tree, {
      propName: "plan",
    });
    expect(chain.steps[0]?.stepRole).toBe("prop");
    expect(chain.steps[0]?.loc?.startLine).toBe(14);
    expect(chain.steps[0]?.loc?.filePath).toContain("PlanSection.tsx");
  });

  test("nested if-return paths combine reachability gates", () => {
    const graph = analyzeComponentInFile({
      componentName: "PricingGateFixture",
      entryFile:
        "tools/ai-code-trace-agent/apps/page-logic-visualizer/core/tests/fixtures/if-return-gates.tsx",
      maxDepth: 8,
      rootDir: ROOT_DIR,
    });

    const uiTree = buildUiTree(graph);
    const nodes = flattenUiTree(uiTree);

    const first = nodes.find((node) => node.node.label === "FirstBranch");
    const second = nodes.find((node) => node.node.label === "SecondBranch");
    const fallback = nodes.find((node) => node.node.label === "FallbackBranch");

    expect(first?.gateConditions).toEqual([
      expect.objectContaining({ branch: "true", expression: "!ready" }),
    ]);
    expect(second?.gateConditions).toEqual([
      expect.objectContaining({
        branch: "true",
        expression: "!(!ready) && (!visible)",
      }),
    ]);
    expect(fallback?.gateConditions).toEqual([
      expect.objectContaining({
        branch: "true",
        expression: "!(!ready) && !(!visible)",
      }),
    ]);
  });
});

describe("nested function trace", () => {
  const findCallTreeNode = (
    nodes: NonNullable<
      ReturnType<typeof analyzePageFile>["nodes"][number]["dataFetch"]
    >["nestedCallTree"],
    functionName: string
  ) => {
    for (const node of nodes ?? []) {
      if (node.functionName === functionName) {
        return node;
      }
      const nested = findCallTreeNode(node.children, functionName);
      if (nested) {
        return nested;
      }
    }
    return;
  };

  test("same-file helpers resolve definition loc for nested call tree", () => {
    const graph = analyzePageFile({
      entryFile:
        "apps/web/src/app/_page-logic-visualizer-demo/complex-pricing/page.tsx",
      maxDepth: 8,
      rootDir: ROOT_DIR,
    });

    const fetchNode = graph.nodes.find(
      (node) => node.dataFetch?.functionName === "fetchDemoPageData"
    );
    expect(fetchNode?.dataFetch?.nestedCallTree).toBeDefined();

    const apply = findCallTreeNode(
      fetchNode!.dataFetch!.nestedCallTree,
      "applyPricingRules"
    );
    const normalize = findCallTreeNode(
      fetchNode!.dataFetch!.nestedCallTree,
      "normalizePlanOrder"
    );
    const highlight = findCallTreeNode(
      fetchNode!.dataFetch!.nestedCallTree,
      "highlightBestValue"
    );

    expect(apply?.definitionLoc?.startLine).toBe(4);
    expect(normalize?.definitionLoc?.startLine).toBe(19);
    expect(highlight?.definitionLoc?.startLine).toBe(8);
    expect(highlight?.resolvedFilePath).toContain("pricingRules.ts");
  });
});

describe("route chain", () => {
  test("analyzeRoute merges root layout, segment layout, and page", () => {
    const graph = analyzeRoute({
      appDir: "apps/web",
      maxDepth: 8,
      rootDir: ROOT_DIR,
      route: "/_page-logic-visualizer-demo/complex-pricing",
    });

    expect(graph.routeChain?.length).toBeGreaterThanOrEqual(3);
    expect(graph.routeChain?.[0]?.kind).toBe("route");
    expect(graph.routeChain?.some((entry) => entry.kind === "layout")).toBe(
      true
    );
    expect(graph.routeChain?.at(-1)?.kind).toBe("page");

    const layoutNodes = graph.nodes.filter((node) => node.type === "layout");
    expect(layoutNodes.length).toBeGreaterThan(0);
    expect(graph.rootNodeId.startsWith("route:")).toBe(true);
  });

  test("builds layout traces for demo segment layout", () => {
    const graph = analyzeRoute({
      appDir: "apps/web",
      maxDepth: 8,
      rootDir: ROOT_DIR,
      route: "/_page-logic-visualizer-demo/complex-pricing",
    });

    const demoLayout = graph.routeChain?.find(
      (entry) =>
        entry.filePath.includes("_page-logic-visualizer-demo/layout.tsx") &&
        entry.kind === "layout"
    );
    expect(demoLayout).toBeDefined();

    const trace = graph.layoutTraces?.[demoLayout!.filePath];
    expect(trace?.kind).toBe("layout-trace");
    expect(trace?.layout.name).toBe("PageLogicDemoLayout");
    expect(trace?.props.some((prop) => prop.name === "children")).toBe(true);
    expect(
      trace?.slots.some((slot) => slot.name === "children" && slot.rendered)
    ).toBe(true);
    expect(
      trace?.providers.some((provider) => provider.name === "DemoThemeProvider")
    ).toBe(true);
    expect(
      trace?.renders.some((render) => render.component === "DemoHeader")
    ).toBe(true);
    expect(
      trace?.renders.some((render) => render.component === "DemoFooter")
    ).toBe(true);
    expect(trace?.slots[0]?.target).toBeTruthy();
  });
});

describe("hook-assigned variable data trace", () => {
  test("billingLabel traces consumer assign then hook with hookTrace action", () => {
    const graph = analyzeComponentInFile({
      componentName: "PricingPageDataProvider",
      entryFile:
        "apps/web/src/features/page-logic-demo/PricingPageDataProvider.tsx",
      maxDepth: 8,
      rootDir: ROOT_DIR,
    });

    const provider = graph.nodes.find(
      (node) => node.label === "PricingPageDataProvider"
    );
    expect(provider).toBeDefined();

    const tree = buildUiTree(graph);
    const chain = buildDataTraceChain(
      graph,
      "billingLabel",
      provider!.id,
      tree
    );

    expect(chain.steps.map((step) => step.label)).toEqual([
      "billingLabel",
      "useBillingSummary",
    ]);
    expect(chain.steps[0]?.stepRole).toBe("variable");
    expect(chain.steps[0]?.loc?.startLine).toBe(24);
    expect(chain.steps[0]?.expression).toContain("useBillingSummary");
    expect(chain.steps[1]?.stepRole).toBe("hook");
    expect(chain.steps[1]?.definitionSymbol).toBe("useBillingSummary");
    expect(chain.steps[1]?.hookTrace).toEqual({
      consumerNodeId: provider!.id,
      fieldName: "billingLabel",
      mode: "local",
      sourceHook: "useBillingSummary",
    });
  });

  test("PricingLiveSection billingLabel hook node is traceable in enriched flow graph", () => {
    const graph = analyzeComponentInFile({
      componentName: "PricingLiveSection",
      entryFile: "apps/web/src/features/page-logic-demo/PricingLiveSection.tsx",
      maxDepth: 8,
      rootDir: ROOT_DIR,
    });

    const section = graph.nodes.find(
      (node) => node.label === "PricingLiveSection"
    );
    expect(section).toBeDefined();

    const tree = buildUiTree(graph);
    const chain = buildDataTraceChain(graph, "billingLabel", section!.id, tree);

    const flowGraph = buildEnrichedLinearPropFlowGraph(graph, chain, {
      consumerNodeId: section!.id,
      rootDir: ROOT_DIR,
      variableName: "billingLabel",
    });

    const hookNode = flowGraph.find(
      (node) => node.label === "usePricingPageData"
    );
    expect(hookNode?.traceable).toBe(true);
    expect(hookNode?.expandableSteps?.length).toBeGreaterThan(0);
  });

  test("PricingLiveSection billingLabel usages link to JSX render line", () => {
    const graph = analyzeComponentInFile({
      componentName: "PricingLiveSection",
      entryFile: "apps/web/src/features/page-logic-demo/PricingLiveSection.tsx",
      maxDepth: 8,
      rootDir: ROOT_DIR,
    });

    const section = graph.nodes.find(
      (node) => node.label === "PricingLiveSection"
    );
    expect(section).toBeDefined();

    const usages = buildVariableUsages(graph, section!.id, "billingLabel", {
      rootDir: ROOT_DIR,
    });

    const jsxRender = usages.find((usage) => usage.kind === "jsx-render");
    expect(jsxRender).toBeDefined();
    expect(jsxRender?.file).toBe(
      "apps/web/src/features/page-logic-demo/PricingLiveSection.tsx"
    );
    expect(jsxRender?.line).toBe(15);
  });

  test("PricingLiveSection billingLabel traces to usePricingPageData without nested useContext", () => {
    const graph = analyzeComponentInFile({
      componentName: "PricingLiveSection",
      entryFile: "apps/web/src/features/page-logic-demo/PricingLiveSection.tsx",
      maxDepth: 8,
      rootDir: ROOT_DIR,
    });

    const section = graph.nodes.find(
      (node) => node.label === "PricingLiveSection"
    );
    expect(section).toBeDefined();

    const tree = buildUiTree(graph);
    const chain = buildDataTraceChain(graph, "billingLabel", section!.id, tree);

    expect(chain.steps.map((step) => step.label)).toEqual([
      "billingLabel",
      "usePricingPageData",
    ]);
    expect(chain.steps[1]?.definitionSymbol).toBe("usePricingPageData");
    expect(chain.steps.some((step) => step.label === "useContext")).toBe(false);
  });
});

describe("hook trace", () => {
  test("PricingPageDataProvider billingLabel includes consumer assign and nested useAuthState", () => {
    const graph = analyzeComponentInFile({
      componentName: "PricingPageDataProvider",
      entryFile:
        "apps/web/src/features/page-logic-demo/PricingPageDataProvider.tsx",
      maxDepth: 8,
      rootDir: ROOT_DIR,
    });

    const provider = graph.nodes.find(
      (node) => node.label === "PricingPageDataProvider"
    );
    expect(provider).toBeDefined();

    const trace = buildHookTraceFromDataLocal(
      graph,
      provider!.id,
      "useBillingSummary",
      { fieldName: "billingLabel", rootDir: ROOT_DIR }
    );

    expect(trace?.traceScope).toBe("return-field");
    expect(trace?.focusedReturnField).toBe("billingLabel");
    expect(trace?.inputs.length).toBeGreaterThan(0);
    expect(trace?.inputs[0]?.name).toBe("plans");
    expect(trace?.inputs[0]?.expression).toContain("plans");
    expect(trace?.callExpression).toContain("useBillingSummary");

    const field = trace?.returnFields[0];
    expect(field?.name).toBe("billingLabel");
    expect(field?.steps[0]?.kind).toBe("consumer-assign");
    expect(field?.steps[0]?.expression).toContain("useBillingSummary");

    const authStep = field?.steps.find((step) => step.label === "auth");
    expect(authStep?.kind).toBe("hook-call");
    expect(authStep?.hookName).toBe("useAuthState");
    expect(authStep?.nestedTrace?.hookName).toBe("useAuthState");
    expect(authStep?.nestedTrace?.bindingVariable).toBe("auth");
  });

  test("usePricingPageData billingLabel includes useContext with param trace", () => {
    const graph = analyzeComponentInFile({
      componentName: "PricingLiveSection",
      entryFile: "apps/web/src/features/page-logic-demo/PricingLiveSection.tsx",
      maxDepth: 8,
      rootDir: ROOT_DIR,
    });

    const section = graph.nodes.find(
      (node) => node.label === "PricingLiveSection"
    );
    expect(section).toBeDefined();

    const trace = buildHookTraceFromDataLocal(
      graph,
      section!.id,
      "usePricingPageData",
      { fieldName: "billingLabel", rootDir: ROOT_DIR }
    );

    expect(trace?.hookName).toBe("usePricingPageData");
    expect(trace?.definitionSymbol).toBe("usePricingPageData");
    expect(trace?.definitionFilePath).toContain("PricingPageDataProvider");

    const field =
      trace?.returnFields.find((item) => item.name === "billingLabel") ??
      trace?.returnFields.find((item) => item.name === "value");
    expect(field).toBeDefined();

    const contextStep = trace?.returnFields
      .flatMap((item) => item.steps)
      .find((step) => step.hookName === "useContext");
    expect(contextStep?.isBuiltIn).toBe(true);
    expect(contextStep?.builtInParamExpression).toBe("PricingPageDataContext");
    expect(contextStep?.paramTraceSteps?.length).toBeGreaterThan(0);
    expect(contextStep?.nestedTrace).toBeUndefined();

    const contextBinding = contextStep?.paramTraceSteps?.find(
      (step) => step.label === "PricingPageDataContext"
    );
    expect(contextBinding?.loc?.filePath).toContain("PricingPageDataProvider");
    expect(
      contextStep?.paramTraceSteps?.some(
        (step) => step.label === "PricingPageDataContext.Provider"
      )
    ).toBe(true);

    const billingSummaryStep = contextStep?.paramTraceSteps?.find(
      (step) => step.hookName === "useBillingSummary"
    );
    expect(billingSummaryStep?.definitionFilePath).toContain(
      "useBillingSummary"
    );
    expect(billingSummaryStep?.nestedTrace?.hookName).toBe("useBillingSummary");
    expect(
      billingSummaryStep?.nestedTrace?.returnFields.some(
        (field) => field.name === "billingLabel"
      )
    ).toBe(true);
  });

  test("useBillingSummary full hook trace includes all return fields and inputs", () => {
    const graph = analyzeComponentInFile({
      componentName: "PricingPageDataProvider",
      entryFile:
        "apps/web/src/features/page-logic-demo/PricingPageDataProvider.tsx",
      maxDepth: 8,
      rootDir: ROOT_DIR,
    });

    const provider = graph.nodes.find(
      (node) => node.label === "PricingPageDataProvider"
    );
    const hookEdge = graph.edges.find(
      (edge) =>
        edge.source === provider!.id &&
        edge.type === "uses-hook" &&
        graph.nodes.find((node) => node.id === edge.target)?.label ===
          "useBillingSummary"
    );
    expect(hookEdge).toBeDefined();

    const trace = buildHookTraceView(graph, hookEdge!.target, {
      consumerNodeId: provider!.id,
      rootDir: ROOT_DIR,
      traceScope: "full",
    });

    expect(trace?.traceScope).toBe("full");
    expect(trace?.returnFields.length).toBeGreaterThan(0);
    expect(trace?.inputs.some((input) => input.name === "plans")).toBe(true);
    expect(trace?.effects).toEqual([]);
  });

  test("useLivePricingData reports effect deps, cleanup, and setState warnings", () => {
    const graph = analyzeComponentInFile({
      componentName: "PricingLiveSection",
      entryFile: "apps/web/src/features/page-logic-demo/PricingLiveSection.tsx",
      maxDepth: 8,
      rootDir: ROOT_DIR,
    });

    const liveHook = graph.nodes.find(
      (node) => node.type === "hook" && node.label === "useLivePricingData"
    );
    expect(liveHook).toBeDefined();

    const trace = buildHookTraceView(graph, liveHook!.id, {
      rootDir: ROOT_DIR,
    });
    expect(trace?.hookName).toBe("useLivePricingData");
    expect(
      trace?.effects.some((effect) => effect.hookName === "useEffect")
    ).toBe(true);

    const effect = trace?.effects.find((item) => item.hookName === "useEffect");
    expect(effect?.dependencies).toContain("sidebarOpen");
    expect(effect?.hasCleanup).toBe(true);
    expect(effect?.cleanupExpression).toContain("cancelled");
    expect(
      effect?.warnings.some((warning) => warning.kind === "set-state")
    ).toBe(true);
  });

  test("useDemoPageViewModel traces return field via nested hook", () => {
    const graph = analyzeComponentInFile({
      componentName: "PricingInteractiveSection",
      entryFile:
        "apps/web/src/features/page-logic-demo/PricingInteractiveSection.tsx",
      maxDepth: 8,
      rootDir: ROOT_DIR,
    });

    const viewModelHook = graph.nodes.find(
      (node) => node.type === "hook" && node.label === "useDemoPageViewModel"
    );
    expect(viewModelHook).toBeDefined();

    const trace = buildHookTraceView(graph, viewModelHook!.id, {
      rootDir: ROOT_DIR,
    });
    const faqCount = trace?.returnFields.find(
      (field) => field.name === "faqCount"
    );
    expect(faqCount).toBeDefined();
    expect(
      faqCount?.steps.some(
        (step) =>
          step.kind === "derived" && step.expression.includes("faq.count")
      )
    ).toBe(true);

    const interactive = graph.nodes.find(
      (node) => node.label === "PricingInteractiveSection"
    );
    expect(interactive).toBeDefined();

    const localTrace = buildHookTraceFromDataLocal(
      graph,
      interactive!.id,
      "useDemoPageViewModel",
      { fieldName: "faqCount", rootDir: ROOT_DIR }
    );
    expect(localTrace?.returnFields).toHaveLength(1);
    expect(localTrace?.returnFields[0]?.name).toBe("faqCount");
  });

  test("usePricingPageData full hook trace does not recurse infinitely", () => {
    const graph = analyzeComponentInFile({
      componentName: "PricingLiveSection",
      entryFile: "apps/web/src/features/page-logic-demo/PricingLiveSection.tsx",
      maxDepth: 8,
      rootDir: ROOT_DIR,
    });

    const section = graph.nodes.find(
      (node) => node.label === "PricingLiveSection"
    );
    const hookEdge = graph.edges.find(
      (edge) =>
        edge.source === section!.id &&
        edge.type === "uses-hook" &&
        graph.nodes.find((node) => node.id === edge.target)?.label ===
          "usePricingPageData"
    );
    expect(hookEdge).toBeDefined();

    const trace = buildHookTraceView(graph, hookEdge!.target, {
      consumerNodeId: section!.id,
      rootDir: ROOT_DIR,
      traceScope: "full",
    });

    expect(trace?.hookName).toBe("usePricingPageData");
    expect(() => JSON.stringify(trace)).not.toThrow();
  });

  test("spec-aligned trace includes internal hooks, lineage, usages, and graph", () => {
    const graph = analyzeComponentInFile({
      componentName: "PricingInteractiveSection",
      entryFile:
        "apps/web/src/features/page-logic-demo/PricingInteractiveSection.tsx",
      maxDepth: 8,
      rootDir: ROOT_DIR,
    });

    const interactive = graph.nodes.find(
      (node) => node.label === "PricingInteractiveSection"
    );
    expect(interactive).toBeDefined();

    const trace = buildHookTraceFromDataLocal(
      graph,
      interactive!.id,
      "useDemoPageViewModel",
      { rootDir: ROOT_DIR }
    );

    expect(trace?.internalHooks?.length).toBeGreaterThan(0);
    expect(
      trace?.internalHooks?.some(
        (entry) => entry.hookName === "usePlanSelection"
      )
    ).toBe(true);
    expect(trace?.returnLineage?.length).toBeGreaterThan(0);
    expect(
      trace?.returnLineage?.some(
        (lineage) => lineage.returnedName === "faqCount"
      )
    ).toBe(true);
    expect(trace?.graph?.nodes.length).toBeGreaterThan(0);
    expect(trace?.graph?.edges.length).toBeGreaterThan(0);
    expect(trace?.usages?.some((usage) => usage.kind === "jsx-prop")).toBe(
      true
    );
  });

  test("buildHookTraceFromEffectLocal scopes to one effect hook", () => {
    const graph = analyzeComponentInFile({
      componentName: "PricingLiveSection",
      entryFile: "apps/web/src/features/page-logic-demo/PricingLiveSection.tsx",
      maxDepth: 8,
      rootDir: ROOT_DIR,
    });

    const liveHook = graph.nodes.find(
      (node) => node.type === "hook" && node.label === "useLivePricingData"
    );
    expect(liveHook).toBeDefined();

    const effectTrace = buildHookTraceFromEffectLocal(
      graph,
      liveHook!.id,
      "useEffect",
      { rootDir: ROOT_DIR }
    );
    expect(effectTrace?.returnFields).toHaveLength(0);
    expect(effectTrace?.effects).toHaveLength(1);
    expect(effectTrace?.effects[0]?.hookName).toBe("useEffect");
  });
});

describe("listAppRoutes", () => {
  test("lists routes for creative-studio app", () => {
    const routes = listAppRoutes("apps/creative-studio", ROOT_DIR);
    expect(routes.some((route) => route.route === "/")).toBe(true);
    expect(routes[0]?.pageFile).toContain("page.tsx");
  });

  test("complex pricing route includes nested demo layout", () => {
    const routes = listAppRoutes("apps/web", ROOT_DIR);
    const demo = routes.find((route) => route.route === "/complex-pricing");
    expect(demo?.layouts.length).toBeGreaterThanOrEqual(2);
    expect(
      demo?.layouts.some((layout) =>
        layout.includes("_page-logic-visualizer-demo/layout.tsx")
      )
    ).toBe(true);
  });
});
