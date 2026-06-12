"use client";

import type {
  LayoutTrace,
  PageLogicGraph,
  RouteChainEntry,
} from "@cs/page-logic-visualizer/client";
import { useState } from "react";

import { LayoutTraceContent } from "@/components/LayoutTraceContent";

const KIND_STYLES: Record<RouteChainEntry["kind"], string> = {
  layout: "border-slate-500/50 bg-slate-500/10",
  page: "border-blue-500/50 bg-blue-500/10",
  route: "border-foreground/30 bg-foreground/5",
};

const KIND_LABELS: Record<RouteChainEntry["kind"], string> = {
  layout: "Layout",
  page: "Page",
  route: "Route",
};

interface RouteTraceViewerProps {
  graph: PageLogicGraph;
  selectedRoute: string;
  routeTraceMode: "full" | "page-only" | "from-layout";
  selectedNodeId: string | null;
  onSelectPageEntry: (entry: RouteChainEntry) => void;
}

export function RouteTraceViewer({
  graph,
  selectedRoute,
  routeTraceMode,
  selectedNodeId,
  onSelectPageEntry,
}: RouteTraceViewerProps) {
  const chain = graph.routeChain ?? [];
  const layoutEntries = chain.filter((entry) => entry.kind === "layout");
  const pageEntry = chain.find((entry) => entry.kind === "page");
  const [expandedLayoutId, setExpandedLayoutId] = useState<string | null>(null);

  const layoutTraceFor = (entry: RouteChainEntry): LayoutTrace | undefined =>
    graph.layoutTraces?.[entry.filePath];

  const handleEntryClick = (entry: RouteChainEntry) => {
    if (entry.kind === "layout") {
      setExpandedLayoutId((current) =>
        current === entry.nodeId ? null : entry.nodeId
      );
      return;
    }
    if (entry.kind === "page") {
      onSelectPageEntry(entry);
    }
  };

  return (
    <div className="space-y-4">
      <section className="space-y-4 rounded-lg border bg-card p-4">
        <div>
          <h2 className="text-sm font-semibold">Route composition</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Layout chain → page · mode:{" "}
            {routeTraceMode === "full"
              ? "Full route"
              : (routeTraceMode === "page-only"
                ? "Page only"
                : "From layout")}
          </p>
        </div>

        {chain.length > 0 ? (
          <ol className="space-y-2">
            {chain.map((entry, index) => {
              const isSelected = selectedNodeId === entry.nodeId;
              const isLayoutExpanded =
                entry.kind === "layout" && expandedLayoutId === entry.nodeId;
              const layoutTrace =
                entry.kind === "layout" ? layoutTraceFor(entry) : undefined;

              return (
                <li key={entry.nodeId}>
                  <div className="flex items-stretch gap-2">
                    {index > 0 ? (
                      <div
                        aria-hidden
                        className="flex w-5 shrink-0 flex-col items-center"
                      >
                        <span className="h-2 w-px bg-border" />
                        <span className="text-[10px] text-muted-foreground">
                          ↓
                        </span>
                        <span className="min-h-2 flex-1 w-px bg-border" />
                      </div>
                    ) : (
                      <span className="w-5 shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      {entry.kind === "layout" ? (
                        <div
                          className={[
                            "w-full rounded-lg border p-3 transition-colors",
                            KIND_STYLES[entry.kind],
                            isSelected || isLayoutExpanded
                              ? "ring-2 ring-primary"
                              : "",
                          ].join(" ")}
                        >
                          <button
                            className="w-full text-start hover:brightness-95"
                            onClick={() => handleEntryClick(entry)}
                            type="button"
                          >
                            <span className="font-mono text-[10px] uppercase text-muted-foreground">
                              {KIND_LABELS[entry.kind]}
                            </span>
                            <p className="mt-0.5 text-sm font-semibold">
                              {entry.label}
                            </p>
                            <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                              {entry.filePath}
                            </p>
                            <span className="mt-1.5 inline-block text-[10px] text-primary">
                              {isLayoutExpanded
                                ? "Hide layout trace ▴"
                                : "Expand layout trace ▾"}
                            </span>
                          </button>

                          {isLayoutExpanded && layoutTrace ? (
                            <LayoutTraceContent trace={layoutTrace} />
                          ) : null}
                        </div>
                      ) : (
                        <button
                          className={[
                            "w-full rounded-lg border p-3 text-start transition-colors hover:brightness-95",
                            KIND_STYLES[entry.kind],
                            isSelected ? "ring-2 ring-primary" : "",
                          ].join(" ")}
                          onClick={() => handleEntryClick(entry)}
                          type="button"
                        >
                          <span className="font-mono text-[10px] uppercase text-muted-foreground">
                            {KIND_LABELS[entry.kind]}
                          </span>
                          <p className="mt-0.5 text-sm font-semibold">
                            {entry.label}
                          </p>
                          <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                            {entry.filePath}
                          </p>
                          {entry.kind === "page" ? (
                            <span className="mt-1.5 inline-block text-[10px] text-primary">
                              Open component trace →
                            </span>
                          ) : null}
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            <p>
              {routeTraceMode === "page-only" ? (
                <>
                  Route chain is hidden in <strong>Page only</strong> mode.
                  Switch to <strong>Full route</strong> and analyze again to see
                  layout → page composition.
                </>
              ) : (graph.warnings.some(
                  (warning) => warning.code === "ROUTE_NOT_FOUND"
                ) ? (
                <>
                  Route <strong>{selectedRoute}</strong> could not be resolved
                  to a page file. Pick a route from the dropdown and analyze
                  again.
                </>
              ) : (
                <>
                  No route chain in graph. Analyze with{" "}
                  <strong>Full route</strong> mode to see layout → page
                  composition.
                </>
              ))}
            </p>
            {pageEntry ? (
              <button
                className="mt-2 text-xs text-primary underline"
                onClick={() => onSelectPageEntry(pageEntry)}
                type="button"
              >
                Open page component trace
              </button>
            ) : null}
          </div>
        )}

        {layoutEntries.length > 0 ? (
          <p className="text-[11px] text-muted-foreground">
            {layoutEntries.length} layout
            {layoutEntries.length === 1 ? "" : "s"} wrap{" "}
            <span className="font-mono">{selectedRoute}</span> via{" "}
            <span className="font-mono">children</span> slots.
          </p>
        ) : null}
      </section>
    </div>
  );
}
