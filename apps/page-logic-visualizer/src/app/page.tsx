"use client";

import type {
  DataTraceChain,
  GraphSearchResult,
  HookTraceView,
  LogicGraphNode,
  PageLogicGraph,
  RouteChainEntry,
  SearchScope,
  UiLocalItem,
} from "@cs/page-logic-visualizer/client";
import {
  buildDataTraceChain,
  buildUiTree,
  findUiTreeNodePath,
  searchGraph,
} from "@cs/page-logic-visualizer/client";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ComponentTraceViewer } from "@/components/ComponentTraceViewer";
import { RouteSelector } from "@/components/RouteSelector";
import type { RouteTraceMode } from "@/components/RouteSelector";
import type { RouteEntry } from "@/components/RouteSelector";
import { RouteTraceViewer } from "@/components/RouteTraceViewer";
import { SearchBox } from "@/components/SearchBox";
import { SearchResults } from "@/components/SearchResults";
import { SourceCodeDrawer } from "@/components/SourceCodeDrawer";
import { TraceBreadcrumb } from "@/components/TraceBreadcrumb";
import type { HookTraceRequest } from "@/components/UiGraphViewer";
import type {
  LocalItemTone,
  SourceViewTarget,
  TraceStepFocusMeta,
  pickDefaultTraceStep,
} from "@/lib/sourceView";
import {
  pickInitialTraceStep,
  resolveTraceFocus,
  sourceTargetForDataUse,
  sourceTargetForLocalItem,
  sourceTargetFromTraceStep,
  traceStepFocusMeta,
} from "@/lib/sourceView";

const ANALYZE_MAX_DEPTH = 8;

type ViewMode = "route" | "component";

interface ActivePropTrace {
  consumerNodeId: string;
  propName: string;
}

interface ActiveVariableTrace {
  consumerNodeId: string;
  variableName: string;
}

interface ActiveHookTraceContext {
  consumerNodeId?: string;
}

export default function VisualizerPage() {
  const [apps, setApps] = useState<string[]>([]);
  const [routes, setRoutes] = useState<RouteEntry[]>([]);
  const [selectedApp, setSelectedApp] = useState("");
  const [selectedRoute, setSelectedRoute] = useState("");
  const [entryFile, setEntryFile] = useState("");
  const [routeTraceMode, setRouteTraceMode] = useState<RouteTraceMode>("full");
  const [layoutFile, setLayoutFile] = useState<string | undefined>();
  const [graph, setGraph] = useState<PageLogicGraph | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("route");
  const [activePropTrace, setActivePropTrace] =
    useState<ActivePropTrace | null>(null);
  const [activeVariableTrace, setActiveVariableTrace] =
    useState<ActiveVariableTrace | null>(null);
  const [componentFocusNodeId, setComponentFocusNodeId] = useState<
    string | null
  >(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [searchScope, setSearchScope] = useState<SearchScope>("all");
  const [searchOpen, setSearchOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [expandingNodeId, setExpandingNodeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeDataTrace, setActiveDataTrace] = useState<DataTraceChain | null>(
    null
  );
  const [activeHookTrace, setActiveHookTrace] = useState<HookTraceView | null>(
    null
  );
  const [hookTraceContext, setHookTraceContext] =
    useState<ActiveHookTraceContext | null>(null);
  const [sourceTarget, setSourceTarget] = useState<SourceViewTarget | null>(
    null
  );
  const [sourceDrawerOpen, setSourceDrawerOpen] = useState(false);
  const [sourceNotice, setSourceNotice] = useState<string | null>(null);
  const [focusedTraceStepId, setFocusedTraceStepId] = useState<string | null>(
    null
  );
  const componentFocusId = useMemo(() => {
    if (!graph) {
      return null;
    }
    return componentFocusNodeId ?? graph.rootNodeId;
  }, [componentFocusNodeId, graph]);

  const searchResults = useMemo(() => {
    if (!graph || search.trim().length < 2) {
      return [];
    }
    return searchGraph(graph, { query: search, scope: searchScope });
  }, [graph, search, searchScope]);

  const pageChainEntry = useMemo(
    () => graph?.routeChain?.find((entry) => entry.kind === "page"),
    [graph]
  );

  const innerComponentPath = useMemo(() => {
    if (
      !graph ||
      !pageChainEntry ||
      viewMode !== "component" ||
      !componentFocusId
    ) {
      return [];
    }
    const uiTree = buildUiTree(graph);
    if (!uiTree) {
      return [];
    }
    const fullPath = findUiTreeNodePath(uiTree, componentFocusId);
    if (!fullPath) {
      return [];
    }
    const pageIndex = fullPath.findIndex(
      (node) => node.nodeId === pageChainEntry.nodeId
    );
    if (pageIndex === -1) {
      return [];
    }
    return fullPath.slice(pageIndex + 1);
  }, [componentFocusId, graph, pageChainEntry, viewMode]);

  const queueSource = useCallback((target: SourceViewTarget | null) => {
    if (target) {
      setSourceNotice(null);
      setSourceTarget(target);
      setSourceDrawerOpen(true);
    } else {
      setSourceTarget(null);
      setSourceDrawerOpen(false);
    }
  }, []);

  const loadApps = useCallback(async () => {
    const response = await fetch("/api/apps");
    if (!response.ok) {
      setError(`Failed to load apps (${response.status})`);
      return;
    }
    const data = (await response.json()) as { apps: string[] };
    setApps(data.apps);
    if (data.apps.length > 0) {
      setSelectedApp((current) => {
        if (current && data.apps.includes(current)) {
          return current;
        }
        return (
          data.apps.find((app) => app.endsWith("/web")) ?? data.apps[0] ?? ""
        );
      });
    }
  }, []);

  const loadRoutes = useCallback(async (appDir: string) => {
    if (!appDir) {
      return;
    }
    const response = await fetch(
      `/api/routes?appDir=${encodeURIComponent(appDir)}`
    );
    if (!response.ok) {
      setError(`Failed to load routes (${response.status})`);
      setRoutes([]);
      return;
    }
    const data = (await response.json()) as { routes: RouteEntry[] };
    setRoutes(data.routes);
    const preferred =
      data.routes.find((route) => route.route === "/complex-pricing") ??
      data.routes.find((route) => route.route.startsWith("/level-")) ??
      data.routes[0];
    if (preferred) {
      setSelectedRoute(preferred.route);
      setEntryFile(preferred.pageFile);
      setLayoutFile(preferred.layouts[0]);
    } else {
      setSelectedRoute("");
      setEntryFile("");
      setLayoutFile(undefined);
      setError(`No routes found in ${appDir}`);
    }
  }, []);

  const analyze = useCallback(
    async (
      filePath: string,
      route?: string,
      appDir?: string,
      mode?: RouteTraceMode,
      startLayout?: string
    ) => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/analyze", {
          body: JSON.stringify({
            appDir: appDir ?? selectedApp,
            entryFile: filePath,
            layoutFile:
              (mode ?? routeTraceMode) === "from-layout"
                ? (startLayout ?? layoutFile)
                : undefined,
            maxDepth: ANALYZE_MAX_DEPTH,
            route,
            routeTraceMode: mode ?? routeTraceMode,
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });

        const data = (await response.json()) as {
          graph?: PageLogicGraph;
          error?: string;
        };

        if (!response.ok || !data.graph) {
          throw new Error(data.error ?? "Failed to analyze page");
        }

        setGraph(data.graph);
        setViewMode("route");
        setActivePropTrace(null);
        setActiveVariableTrace(null);
        setComponentFocusNodeId(null);
        setSelectedNodeId(data.graph.rootNodeId);
        setActiveDataTrace(null);
        setActiveHookTrace(null);
        setHookTraceContext(null);
        setSourceTarget(null);
        setSourceDrawerOpen(false);
      } catch (analyzeError) {
        setError(
          analyzeError instanceof Error
            ? analyzeError.message
            : "Analysis failed"
        );
      } finally {
        setIsLoading(false);
      }
    },
    [layoutFile, routeTraceMode, selectedApp]
  );

  const expandNode = useCallback(
    async (node: LogicGraphNode) => {
      if (!graph?.nodes.length || !node.filePath) {
        return;
      }

      setExpandingNodeId(node.id);
      setError(null);

      try {
        const response = await fetch("/api/analyze/expand", {
          body: JSON.stringify({
            anchorNodeId: node.id,
            componentName: node.label,
            filePath: node.filePath,
            graph,
            maxDepth: ANALYZE_MAX_DEPTH,
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });

        const data = (await response.json()) as {
          graph?: PageLogicGraph;
          error?: string;
        };

        if (!response.ok || !data.graph) {
          throw new Error(data.error ?? "Failed to expand component");
        }

        setGraph(data.graph);
        setSelectedNodeId(node.id);
      } catch (expandError) {
        setError(
          expandError instanceof Error ? expandError.message : "Expand failed"
        );
      } finally {
        setExpandingNodeId(null);
      }
    },
    [graph]
  );

  const selectNode = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
  }, []);

  const openSourceForNode = useCallback(
    (nodeId: string, traceMeta?: TraceStepFocusMeta) => {
      setSelectedNodeId(nodeId);
      setFocusedTraceStepId(nodeId);
      if (!graph) {
        return;
      }
      const { notice, target } = resolveTraceFocus(graph, nodeId, traceMeta);
      if (notice) {
        setSourceNotice(notice);
        setSourceDrawerOpen(true);
        return;
      }
      if (target) {
        queueSource(target);
      }
    },
    [graph, queueSource]
  );

  const openSourceForLocal = useCallback(
    (consumerNodeId: string, item: UiLocalItem, tone: LocalItemTone) => {
      if (!graph) {
        return;
      }
      setSelectedNodeId(consumerNodeId);
      const target = sourceTargetForLocalItem(
        graph,
        consumerNodeId,
        item,
        tone
      );
      if (target) {
        queueSource(target);
      }
    },
    [graph, queueSource]
  );

  const focusTraceStep = useCallback(
    (step: NonNullable<ReturnType<typeof pickDefaultTraceStep>>) => {
      if (!graph) {
        return;
      }
      setFocusedTraceStepId(step.nodeId);
      const { notice, target } = resolveTraceFocus(
        graph,
        step.nodeId,
        traceStepFocusMeta(step)
      );
      if (notice) {
        setSourceNotice(notice);
        setSourceDrawerOpen(true);
        return;
      }
      if (target) {
        queueSource(target);
      }
    },
    [graph, queueSource]
  );

  const traceDataFromCard = useCallback(
    (
      expression: string,
      consumerNodeId: string,
      options?: { propName?: string; variableName?: string }
    ) => {
      if (!graph) {
        return;
      }

      setSelectedNodeId(consumerNodeId);
      setComponentFocusNodeId(consumerNodeId);
      setViewMode("component");
      setActiveHookTrace(null);
      setHookTraceContext(null);

      if (options?.propName) {
        setActivePropTrace({
          consumerNodeId,
          propName: options.propName,
        });
        setActiveVariableTrace(null);
        setActiveDataTrace(null);
        setFocusedTraceStepId(null);
        setSourceTarget(null);
        setSourceNotice(null);
        setSourceDrawerOpen(true);
        return;
      }

      if (options?.variableName) {
        setActiveVariableTrace({
          consumerNodeId,
          variableName: options.variableName,
        });
        setActivePropTrace(null);
        setActiveDataTrace(null);
        setFocusedTraceStepId(null);
        setSourceTarget(null);
        setSourceNotice(null);
        setSourceDrawerOpen(true);
        return;
      }

      const chain = buildDataTraceChain(
        graph,
        expression,
        consumerNodeId,
        buildUiTree(graph),
        options
      );
      setActivePropTrace(null);
      setActiveVariableTrace(null);
      setActiveDataTrace(chain.steps.length > 0 ? chain : null);

      if (chain.steps.length === 0) {
        setFocusedTraceStepId(null);
        const usageTarget = sourceTargetForDataUse(
          graph,
          consumerNodeId,
          expression
        );
        if (usageTarget) {
          queueSource(usageTarget);
        }
        return;
      }

      const initialStep = pickInitialTraceStep(chain, {
        consumerNodeId,
        propName: options?.propName,
      });
      if (initialStep) {
        focusTraceStep(initialStep);
      }
    },
    [graph, focusTraceStep, queueSource]
  );

  const closeSourceDrawer = useCallback(() => {
    setSourceDrawerOpen(false);
    setSourceNotice(null);
    setActivePropTrace(null);
    setActiveVariableTrace(null);
    setActiveDataTrace(null);
    setActiveHookTrace(null);
    setHookTraceContext(null);
    setFocusedTraceStepId(null);
  }, []);

  const traceHookFromCard = useCallback(
    async (
      request: HookTraceRequest,
      options?: { keepDataTrace?: boolean; openDrawer?: boolean }
    ): Promise<HookTraceView | undefined> => {
      if (!graph) {
        return undefined;
      }

      setError(null);

      const body =
        request.mode === "hook"
          ? {
              consumerNodeId: request.consumerNodeId,
              graph,
              hookNodeId: request.hookNodeId,
              mode: "hook" as const,
            }
          : (request.mode === "effect"
            ? {
                consumerNodeId: request.consumerNodeId,
                effectHookName: request.effectHookName,
                graph,
                mode: "effect" as const,
              }
            : {
                consumerNodeId: request.consumerNodeId,
                fieldName: request.fieldName,
                graph,
                mode: "local" as const,
                sourceHook: request.sourceHook,
              });

      try {
        const response = await fetch("/api/analyze/hook-trace", {
          body: JSON.stringify(body),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });

        const data = (await response.json()) as {
          error?: string;
          trace?: HookTraceView;
        };

        if (!response.ok || !data.trace) {
          throw new Error(data.error ?? "Failed to trace hook");
        }

        if (!options?.keepDataTrace) {
          setActivePropTrace(null);
          setActiveVariableTrace(null);
          setActiveDataTrace(null);
          setActiveHookTrace(data.trace);
          setHookTraceContext({
            consumerNodeId:
              request.consumerNodeId ??
              (request.mode === "hook"
                ? (componentFocusId ?? undefined)
                : undefined),
          });
          setFocusedTraceStepId(null);
          setSourceTarget(null);
          setSourceNotice(null);

          const focusNodeId =
            request.mode === "hook"
              ? request.hookNodeId
              : data.trace.hookNodeId;
          setSelectedNodeId(focusNodeId);

          if (options?.openDrawer !== false) {
            setSourceDrawerOpen(true);
          }
        }

        return data.trace;
      } catch (traceError) {
        setError(
          traceError instanceof Error ? traceError.message : "Hook trace failed"
        );
        return undefined;
      }
    },
    [componentFocusId, graph]
  );

  const openHookTrace = useCallback(
    (request: HookTraceRequest) => {
      if (request.mode !== "hook") {
        setComponentFocusNodeId(request.consumerNodeId);
      }
      setViewMode("component");
      const resolvedRequest =
        request.mode === "hook" && !request.consumerNodeId && componentFocusId
          ? { ...request, consumerNodeId: componentFocusId }
          : request;
      void traceHookFromCard(resolvedRequest);
    },
    [componentFocusId, traceHookFromCard]
  );

  const openPageTrace = useCallback((entry: RouteChainEntry) => {
    if (entry.kind !== "page") {
      return;
    }
    setComponentFocusNodeId(entry.nodeId);
    setSelectedNodeId(entry.nodeId);
    setViewMode("component");
  }, []);

  const goToRouteView = useCallback(() => {
    setViewMode("route");
    setActiveHookTrace(null);
    setHookTraceContext(null);
    if (graph) {
      setSelectedNodeId(graph.rootNodeId);
    }
  }, [graph]);

  const goToPageView = useCallback(() => {
    if (pageChainEntry) {
      openPageTrace(pageChainEntry);
    }
  }, [openPageTrace, pageChainEntry]);

  const navigateInnerComponent = useCallback((nodeId: string) => {
    setComponentFocusNodeId(nodeId);
    setSelectedNodeId(nodeId);
    setViewMode("component");
  }, []);

  const handleSearchSelect = useCallback(
    (result: GraphSearchResult) => {
      setSearchOpen(false);
      if (result.nodeId) {
        setSelectedNodeId(result.nodeId);
        setComponentFocusNodeId(result.nodeId);
      }
      if (result.layer === "data-flow" && result.nodeId) {
        setViewMode("component");
        traceDataFromCard(result.label, result.nodeId);
      } else if (result.kind === "variable" && result.nodeId) {
        setViewMode("component");
        traceDataFromCard(result.label, result.nodeId, {
          variableName: result.label,
        });
      } else if (result.kind === "hook" && result.nodeId) {
        setViewMode("component");
        setComponentFocusNodeId(result.nodeId);
        openHookTrace({ hookNodeId: result.nodeId, mode: "hook" });
      } else if (result.kind === "component" || result.kind === "route") {
        setViewMode(result.kind === "route" ? "route" : "component");
      } else if (result.nodeId) {
        setViewMode("component");
      }
    },
    [openHookTrace, traceDataFromCard]
  );

  useEffect(() => {
    void loadApps();
  }, [loadApps]);

  useEffect(() => {
    void loadRoutes(selectedApp);
  }, [loadRoutes, selectedApp]);

  return (
    <main className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          <h1 className="me-2 shrink-0 text-sm font-semibold tracking-tight">
            Page Logic Visualizer
          </h1>

          <RouteSelector
            apps={apps}
            isLoading={isLoading}
            layoutFile={layoutFile}
            onAnalyze={() =>
              void analyze(entryFile, selectedRoute, selectedApp)
            }
            onAppChange={setSelectedApp}
            onEntryFileChange={setEntryFile}
            onLayoutFileChange={setLayoutFile}
            onRouteChange={setSelectedRoute}
            onRouteTraceModeChange={setRouteTraceMode}
            routeTraceMode={routeTraceMode}
            routes={routes}
            selectedApp={selectedApp}
            selectedRoute={selectedRoute}
          />

          <div className="hidden h-6 w-px bg-border sm:block" />

          <div className="relative min-w-[160px] flex-1">
            <SearchBox
              onChange={(value) => {
                setSearch(value);
                setSearchOpen(value.trim().length >= 2);
              }}
              placeholder="Search route, component, hook, variable…"
              value={search}
            />
            {searchOpen && search.trim().length >= 2 ? (
              <SearchResults
                onScopeChange={setSearchScope}
                onSelect={handleSearchSelect}
                results={searchResults}
                scope={searchScope}
              />
            ) : null}
          </div>
        </div>
      </header>

      {error ? (
        <div className="mx-4 mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="flex-1 p-4">
        <section className="min-w-0 space-y-3">
          {graph ? (
            <TraceBreadcrumb
              graph={graph}
              innerPath={innerComponentPath}
              onNavigateInner={navigateInnerComponent}
              onSelectLayouts={goToRouteView}
              onSelectPage={goToPageView}
              onSelectRoute={goToRouteView}
              selectedRoute={selectedRoute}
              viewMode={viewMode}
            />
          ) : null}

          {!graph ? (
            <div className="flex h-[calc(100vh-10rem)] items-center justify-center rounded-lg border text-sm text-muted-foreground">
              Select a route and click Analyze to start route trace.
            </div>
          ) : null}

          {graph && viewMode === "route" ? (
            <RouteTraceViewer
              graph={graph}
              onSelectPageEntry={openPageTrace}
              routeTraceMode={routeTraceMode}
              selectedNodeId={selectedNodeId}
              selectedRoute={selectedRoute}
            />
          ) : null}

          {graph && viewMode === "component" && componentFocusId ? (
            <ComponentTraceViewer
              activeTrace={activeDataTrace}
              expandingNodeId={expandingNodeId}
              focusNodeId={componentFocusId}
              graph={graph}
              onExpandNode={(node) => void expandNode(node)}
              onFocusNodeChange={setComponentFocusNodeId}
              onOpenSourceLocal={openSourceForLocal}
              onOpenSourceNode={openSourceForNode}
              onSelectNode={selectNode}
              onTraceData={traceDataFromCard}
              onTraceHook={traceHookFromCard}
              search={search}
              selectedNodeId={selectedNodeId}
            />
          ) : null}
        </section>
      </div>

      <SourceCodeDrawer
        focusedTraceStepId={focusedTraceStepId}
        graph={graph}
        hookTrace={activeHookTrace}
        hookTraceContext={hookTraceContext}
        onClose={closeSourceDrawer}
        onTraceHook={traceHookFromCard}
        onTraceStepFocus={openSourceForNode}
        open={sourceDrawerOpen}
        propTrace={activePropTrace}
        variableTrace={activeVariableTrace}
        sourceNotice={sourceNotice}
        target={sourceTarget}
        trace={activeDataTrace}
        traceLevel={viewMode === "route" ? "route" : "component"}
      />
    </main>
  );
}
