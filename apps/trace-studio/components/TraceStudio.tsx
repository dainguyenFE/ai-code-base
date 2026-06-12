"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  DataFlowGraphResponse,
  InspectorItem,
  ScopeItem,
  SearchResultItem,
  TraceEdge,
  TraceNode,
  TraceGraphResponse,
  SourceSnippet,
} from "@/lib/types";

import { ComponentInspector } from "./ComponentInspector";
import { PanelCollapseButton } from "./PanelCollapseButton";
import { ResizeHandle } from "./ResizeHandle";
import { SourceCodePanel } from "./SourceCodePanel";
import { TraceGraph } from "./TraceGraph";

const COMPONENT_SEARCH_TYPES = new Set(["component", "route", "page"]);

const LEFT_WIDTH_DEFAULT = 200;
const LEFT_WIDTH_MIN = 160;
const LEFT_WIDTH_MAX = 420;
const RIGHT_WIDTH_DEFAULT = 300;
const RIGHT_WIDTH_MIN = 220;
const RIGHT_WIDTH_MAX = 520;
const SOURCE_RATIO_DEFAULT = 0.32;
const SOURCE_RATIO_MIN = 0.15;
const SOURCE_RATIO_MAX = 0.72;
const GRAPH_SPLIT_DEFAULT = 0.5;
const GRAPH_SPLIT_MIN = 0.25;
const GRAPH_SPLIT_MAX = 0.75;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function TraceStudio() {
  const [scopes, setScopes] = useState<ScopeItem[]>([]);
  const [scope, setScope] = useState("default");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [nodes, setNodes] = useState<TraceNode[]>([]);
  const [edges, setEdges] = useState<TraceEdge[]>([]);
  const [dataFlowNodes, setDataFlowNodes] = useState<TraceNode[]>([]);
  const [dataFlowEdges, setDataFlowEdges] = useState<TraceEdge[]>([]);
  const [dataFlowFocus, setDataFlowFocus] = useState<string | undefined>();
  const [dataFlowFocusNodeId, setDataFlowFocusNodeId] = useState<
    string | undefined
  >();
  const [dataFlowPropSinkId, setDataFlowPropSinkId] = useState<
    string | undefined
  >();
  const [selectedInspectorItemId, setSelectedInspectorItemId] = useState<
    string | undefined
  >();
  const [rootTraceId, setRootTraceId] = useState<string | undefined>();
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>();
  const [selectedNode, setSelectedNode] = useState<TraceNode | undefined>();
  const [source, setSource] = useState<SourceSnippet | undefined>();
  const [highlightLine, setHighlightLine] = useState<number | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [leftWidth, setLeftWidth] = useState(LEFT_WIDTH_DEFAULT);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightWidth, setRightWidth] = useState(RIGHT_WIDTH_DEFAULT);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [sourceHeightRatio, setSourceHeightRatio] =
    useState(SOURCE_RATIO_DEFAULT);
  const [graphSplitRatio, setGraphSplitRatio] = useState(GRAPH_SPLIT_DEFAULT);

  const centerColumnRef = useRef<HTMLDivElement>(null);
  const rightColumnRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void fetch("/api/scopes")
      .then((res) => res.json())
      .then(
        (data: {
          defaultScope: string;
          items: ScopeItem[];
          error?: string;
        }) => {
          if (data.error) {
            setError(data.error);
            return;
          }
          setScopes(data.items);
          setScope(data.defaultScope);
        }
      )
      .catch((error: Error) => setError(error.message));
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    const timeout = setTimeout(() => {
      void fetch(
        `/api/trace/search?scope=${scope}&q=${encodeURIComponent(query)}`
      )
        .then((res) => res.json())
        .then((data: { items: SearchResultItem[]; error?: string }) => {
          if (data.error) {
            setError(data.error);
            return;
          }
          setResults(data.items);
        })
        .catch((error: Error) => setError(error.message));
    }, 250);

    return () => clearTimeout(timeout);
  }, [query, scope]);

  const visibleResults = useMemo(
    () => results.filter((item) => COMPONENT_SEARCH_TYPES.has(item.type)),
    [results]
  );

  const fetchNodeDetail = useCallback(
    async (nodeId: string) => {
      const res = await fetch(
        `/api/trace/node?scope=${scope}&id=${encodeURIComponent(nodeId)}&view=component`
      );
      const data = (await res.json()) as TraceGraphResponse & {
        error?: string;
      };

      if (!res.ok || data.error) {
        throw new Error(data.error ?? "Failed to load node");
      }

      return data;
    },
    [scope]
  );

  const fetchDataFlow = useCallback(
    async (
      nodeId: string,
      focus?: string,
      focusKind?: InspectorItem["focusKind"]
    ) => {
      const params = new URLSearchParams({ id: nodeId });
      if (focus) {
        params.set("focus", focus);
      }
      if (focusKind) {
        params.set("focusKind", focusKind);
      }

      const res = await fetch(`/api/trace/data-flow?${params.toString()}`);
      const data = (await res.json()) as DataFlowGraphResponse & {
        error?: string;
      };

      if (!res.ok || data.error) {
        throw new Error(data.error ?? "Failed to load data flow");
      }

      return data;
    },
    []
  );

  const loadSourceSnippet = useCallback(
    async (filePath: string, startLine: number, endLine: number) => {
      const res = await fetch(
        `/api/source/snippet?file=${encodeURIComponent(filePath)}&start=${startLine}&end=${endLine}`
      );
      const data = (await res.json()) as SourceSnippet & { error?: string };

      if (!res.ok || data.error) {
        throw new Error(data.error ?? "Failed to load source");
      }

      setSource(data);
    },
    []
  );

  const clearDataFlow = useCallback(() => {
    setDataFlowNodes([]);
    setDataFlowEdges([]);
    setDataFlowFocus(undefined);
    setDataFlowFocusNodeId(undefined);
    setDataFlowPropSinkId(undefined);
  }, []);

  const applyDataFlow = useCallback((dataFlow: DataFlowGraphResponse) => {
    setDataFlowNodes(dataFlow.nodes);
    setDataFlowEdges(dataFlow.edges);
    setDataFlowFocus(dataFlow.focusLabel);
    setDataFlowPropSinkId(dataFlow.propSinkId ?? dataFlow.focusNodeId);
    setDataFlowFocusNodeId(dataFlow.propSinkId ?? dataFlow.focusNodeId);
  }, []);

  const loadRootTrace = useCallback(
    async (nodeId: string) => {
      setLoading(true);
      setError(null);
      setHighlightLine(undefined);
      setSelectedInspectorItemId(undefined);
      clearDataFlow();

      try {
        const data = await fetchNodeDetail(nodeId);
        setRootTraceId(nodeId);
        setSelectedNodeId(nodeId);
        setNodes(data.nodes);
        setEdges(data.edges);
        setSelectedNode(data.centerNode);
        setSource(data.source);
      } catch (error) {
        setError(
          error instanceof Error ? error.message : "Failed to load trace"
        );
      } finally {
        setLoading(false);
      }
    },
    [clearDataFlow, fetchNodeDetail]
  );

  const selectCompositionNode = useCallback(
    async (nodeId: string) => {
      if (!rootTraceId) {
        await loadRootTrace(nodeId);
        return;
      }

      setSelectedNodeId(nodeId);
      setHighlightLine(undefined);
      setSelectedInspectorItemId(undefined);
      clearDataFlow();
      setError(null);

      const existing = nodes.find((node) => node.id === nodeId);
      if (existing) {
        setSelectedNode(existing);
      }

      try {
        const data = await fetchNodeDetail(nodeId);
        setSelectedNode(data.centerNode);
        setSource(data.source);
      } catch (error) {
        setError(
          error instanceof Error ? error.message : "Failed to load node detail"
        );
      }
    },
    [clearDataFlow, fetchNodeDetail, loadRootTrace, nodes, rootTraceId]
  );

  const selectDataFlowNode = useCallback(
    async (nodeId: string) => {
      const node = dataFlowNodes.find((item) => item.id === nodeId);
      if (!node) {
        return;
      }

      setError(null);

      if (node.type === "component") {
        const passEdge = dataFlowEdges.find(
          (edge) =>
            edge.type === "passes_prop" &&
            edge.from === nodeId &&
            edge.to === dataFlowPropSinkId
        );
        const line = passEdge?.metadata?.line;
        if (line) {
          setHighlightLine(line);
        }
      } else if (node.metadata?.line) {
        setHighlightLine(node.metadata.line);
      } else if (node.type === "prop" && selectedNode?.filePath) {
        setHighlightLine(selectedNode.startLine);
      }

      if (!node.filePath) {
        return;
      }

      const startLine = node.startLine ?? node.metadata?.line ?? 1;
      const endLine = node.endLine ?? startLine + 6;

      try {
        await loadSourceSnippet(node.filePath, startLine, endLine);
      } catch (error) {
        setError(
          error instanceof Error ? error.message : "Failed to load source"
        );
      }
    },
    [
      dataFlowEdges,
      dataFlowNodes,
      dataFlowPropSinkId,
      loadSourceSnippet,
      selectedNode,
    ]
  );

  const handleInspectorItemClick = useCallback(
    async (item: InspectorItem) => {
      if (!selectedNodeId) {
        return;
      }

      setSelectedInspectorItemId(item.id);
      setError(null);

      if (item.line) {
        setHighlightLine(item.line);
      }

      try {
        const dataFlow = await fetchDataFlow(
          selectedNodeId,
          item.focus,
          item.focusKind
        );
        applyDataFlow(dataFlow);

        if (item.filePath && item.startLine && item.endLine) {
          await loadSourceSnippet(item.filePath, item.startLine, item.endLine);
        } else if (item.filePath && item.line) {
          const start = Math.max(1, item.line - 3);
          const end = item.line + 3;
          await loadSourceSnippet(item.filePath, start, end);
        }
      } catch (error) {
        setError(
          error instanceof Error ? error.message : "Failed to load data flow"
        );
      }
    },
    [applyDataFlow, fetchDataFlow, loadSourceSnippet, selectedNodeId]
  );

  const handleLeftResize = useCallback((delta: number) => {
    setLeftWidth((width) =>
      clamp(width + delta, LEFT_WIDTH_MIN, LEFT_WIDTH_MAX)
    );
  }, []);

  const handleRightResize = useCallback((delta: number) => {
    setRightWidth((width) =>
      clamp(width - delta, RIGHT_WIDTH_MIN, RIGHT_WIDTH_MAX)
    );
  }, []);

  const handleSourceResize = useCallback((delta: number) => {
    const height = rightColumnRef.current?.clientHeight ?? 600;
    setSourceHeightRatio((ratio) =>
      clamp(ratio - delta / height, SOURCE_RATIO_MIN, SOURCE_RATIO_MAX)
    );
  }, []);

  const handleGraphSplitResize = useCallback((delta: number) => {
    const width = centerColumnRef.current?.clientWidth ?? 900;
    setGraphSplitRatio((ratio) =>
      clamp(ratio + delta / width, GRAPH_SPLIT_MIN, GRAPH_SPLIT_MAX)
    );
  }, []);

  const selectedId = selectedNodeId ?? selectedNode?.id;

  const panelStyle = useMemo(
    () => ({
      background: "var(--panel)",
      border: "1px solid var(--border)",
      borderRadius: 8,
      display: "flex",
      flexDirection: "column" as const,
      minHeight: 0,
      overflow: "hidden",
    }),
    []
  );

  const graphHeaderStyle = {
    borderBottom: "1px solid var(--border)",
    color: "var(--muted)",
    flexShrink: 0,
    fontSize: 11,
    padding: "6px 10px",
  } as const;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <header
        style={{
          alignItems: "center",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          gap: 12,
          padding: "12px 16px",
        }}
      >
        <strong>AI Trace Studio</strong>
        <label style={{ alignItems: "center", display: "flex", gap: 8 }}>
          <span style={{ color: "var(--muted)", fontSize: 13 }}>Scope</span>
          <select
            onChange={(e) => setScope(e.target.value)}
            style={{
              background: "var(--input-bg)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              color: "var(--text)",
              padding: "6px 8px",
            }}
            value={scope}
          >
            {scopes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <input
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search component or route..."
          style={{
            background: "var(--input-bg)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            color: "var(--text)",
            flex: 1,
            padding: "8px 12px",
          }}
          value={query}
        />
        {loading ? (
          <span style={{ color: "var(--muted)", fontSize: 13 }}>Loading…</span>
        ) : null}
      </header>

      {error ? (
        <div
          style={{
            background: "var(--error-bg)",
            borderBottom: "1px solid var(--error-border)",
            color: "var(--error-text)",
            fontSize: 13,
            padding: "8px 16px",
          }}
        >
          {error}
        </div>
      ) : null}

      <div
        style={{
          display: "flex",
          flex: 1,
          gap: 0,
          minHeight: 0,
          padding: 12,
        }}
      >
        {!leftCollapsed ? (
          <aside
            style={{
              ...panelStyle,
              flexShrink: 0,
              padding: 12,
              width: leftWidth,
            }}
          >
            <h3 style={{ fontSize: 13, margin: "0 0 8px" }}>Search results</h3>
            <div style={{ flex: 1, overflow: "auto" }}>
              {visibleResults.length === 0 ? (
                <div style={{ color: "var(--muted)", fontSize: 12 }}>
                  {query.trim()
                    ? "No components or routes matched."
                    : "Type to search symbols."}
                </div>
              ) : (
                visibleResults.map((item) => {
                  const isSelected = item.id === selectedId;

                  return (
                    <button
                      key={item.id}
                      onClick={() => void loadRootTrace(item.id)}
                      style={{
                        background: isSelected
                          ? "var(--swimlane-even)"
                          : "transparent",
                        border: "none",
                        borderRadius: 6,
                        color: "var(--text)",
                        cursor: "pointer",
                        display: "block",
                        padding: "6px 8px",
                        textAlign: "left",
                        width: "100%",
                      }}
                      type="button"
                    >
                      <div style={{ fontSize: 13, fontWeight: 600 }}>
                        {item.label}
                      </div>
                      <div style={{ color: "var(--muted)", fontSize: 11 }}>
                        {item.type}
                        {item.filePath ? ` · ${item.filePath}` : ""}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </aside>
        ) : null}

        {!leftCollapsed ? (
          <ResizeHandle axis="horizontal" onResize={handleLeftResize} />
        ) : null}

        <PanelCollapseButton
          collapsed={leftCollapsed}
          edge="left"
          onToggle={() => setLeftCollapsed((value) => !value)}
          title={leftCollapsed ? "Show search" : "Hide search"}
        />

        <div
          ref={centerColumnRef}
          style={{
            display: "grid",
            flex: 1,
            gap: 0,
            gridTemplateColumns: `${graphSplitRatio}fr 6px ${1 - graphSplitRatio}fr`,
            margin: "0 6px",
            minHeight: 0,
            minWidth: 0,
          }}
        >
          <section style={{ ...panelStyle, minHeight: 0, minWidth: 0 }}>
            <div style={graphHeaderStyle}>Composition</div>
            <div style={{ flex: 1, minHeight: 0 }}>
              <TraceGraph
                edges={edges}
                graphMode="component"
                graphVariant="composition"
                highlightId={selectedId}
                layoutAnchorId={rootTraceId}
                nodes={nodes}
                onNodeClick={(id) => void selectCompositionNode(id)}
              />
            </div>
          </section>

          <ResizeHandle axis="horizontal" onResize={handleGraphSplitResize} />

          <section style={{ ...panelStyle, minHeight: 0, minWidth: 0 }}>
            <div style={graphHeaderStyle}>
              Data flow
              {dataFlowFocus ? (
                <>
                  {" "}
                  · prop <strong>{dataFlowFocus}</strong>
                  <span style={{ marginLeft: 6, opacity: 0.75 }}>
                    (upstream → prop, arrows point into selected prop)
                  </span>
                </>
              ) : (
                <span style={{ marginLeft: 6, opacity: 0.75 }}>
                  — click a prop in the inspector
                </span>
              )}
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              <TraceGraph
                edges={dataFlowEdges}
                graphMode="component"
                graphVariant="data-flow"
                highlightId={dataFlowPropSinkId ?? dataFlowFocusNodeId}
                nodes={dataFlowNodes}
                onNodeClick={(id) => void selectDataFlowNode(id)}
              />
            </div>
          </section>
        </div>

        <PanelCollapseButton
          collapsed={rightCollapsed}
          edge="right"
          onToggle={() => setRightCollapsed((value) => !value)}
          title={rightCollapsed ? "Show inspector" : "Hide inspector"}
        />

        {!rightCollapsed ? (
          <ResizeHandle axis="horizontal" onResize={handleRightResize} />
        ) : null}

        {!rightCollapsed ? (
          <aside
            ref={rightColumnRef}
            style={{
              ...panelStyle,
              display: "grid",
              flexShrink: 0,
              gridTemplateRows: `${1 - sourceHeightRatio}fr 6px ${sourceHeightRatio}fr`,
              width: rightWidth,
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                minHeight: 0,
                overflow: "hidden",
                padding: 12,
              }}
            >
              <ComponentInspector
                node={selectedNode}
                onHighlightLine={setHighlightLine}
                onItemClick={(item) => void handleInspectorItemClick(item)}
                onSelectChild={(childId) => void selectCompositionNode(childId)}
                scope={scope}
                selectedItemId={selectedInspectorItemId}
              />
            </div>

            <ResizeHandle axis="vertical" onResize={handleSourceResize} />

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                minHeight: 0,
                overflow: "hidden",
                padding: "0 12px 12px",
              }}
            >
              <h3 style={{ fontSize: 13, margin: "0 0 8px" }}>Source</h3>
              <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
                <SourceCodePanel
                  highlightLine={highlightLine}
                  source={source}
                />
              </div>
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
