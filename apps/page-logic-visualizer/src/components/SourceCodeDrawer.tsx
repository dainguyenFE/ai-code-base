"use client";

import type {
  DataTraceChain,
  HookTraceView,
  PageLogicGraph,
} from "@cs/page-logic-visualizer/client";
import { useEffect, useRef, useState } from "react";

import { DataTraceSidebar } from "@/components/DataTraceSidebar";
import { HookTraceViewer } from "@/components/HookTraceViewer";
import { PropsTraceViewer } from "@/components/PropsTraceViewer";
import type { HookTraceRequest } from "@/components/UiGraphViewer";
import { VariableTraceViewer } from "@/components/VariableTraceViewer";
import type { SourceViewTarget, TraceStepFocusMeta } from "@/lib/sourceView";

interface SourceResponse {
  content: string;
  filePath: string;
  startLine?: number;
  endLine?: number;
  totalLines: number;
  error?: string;
}

type TraceLevel = "route" | "component";

interface PropTraceSelection {
  consumerNodeId: string;
  propName: string;
}

interface VariableTraceSelection {
  consumerNodeId: string;
  variableName: string;
}

const TRACE_DRAWER_TITLES: Record<TraceLevel, string> = {
  component: "Component data trace",
  route: "Source",
};

interface HookTraceSelection {
  consumerNodeId?: string;
}

interface SourceCodeDrawerProps {
  open: boolean;
  graph: PageLogicGraph | null;
  target: SourceViewTarget | null;
  sourceNotice?: string | null;
  trace?: DataTraceChain | null;
  propTrace?: PropTraceSelection | null;
  variableTrace?: VariableTraceSelection | null;
  hookTrace?: HookTraceView | null;
  hookTraceContext?: HookTraceSelection | null;
  focusedTraceStepId?: string | null;
  traceLevel?: TraceLevel;
  onClose: () => void;
  onTraceStepFocus?: (nodeId: string, meta?: TraceStepFocusMeta) => void;
  onTraceHook?: (
    request: HookTraceRequest,
    options?: { keepDataTrace?: boolean }
  ) => Promise<HookTraceView | undefined>;
}

const normalizePath = (filePath: string): string =>
  filePath.replaceAll("\\", "/");

const isLineHighlighted = (
  lineNumber: number,
  startLine?: number,
  endLine?: number
): boolean => {
  if (!startLine) {
    return false;
  }
  const end = endLine ?? startLine;
  return lineNumber >= startLine && lineNumber <= end;
};

export function SourceCodeDrawer({
  open,
  graph,
  target,
  sourceNotice,
  trace,
  propTrace,
  variableTrace,
  hookTrace,
  hookTraceContext,
  focusedTraceStepId,
  traceLevel = "component",
  onClose,
  onTraceStepFocus,
  onTraceHook,
}: SourceCodeDrawerProps) {
  const [data, setData] = useState<SourceResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const loadedDataRef = useRef<SourceResponse | null>(null);

  const showPropTrace = Boolean(open && propTrace && graph);
  const showVariableTrace = Boolean(open && variableTrace && graph);
  const showHookTrace = Boolean(open && hookTrace && graph);

  useEffect(() => {
    loadedDataRef.current = data;
  }, [data]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (
      !open ||
      !target ||
      showPropTrace ||
      showVariableTrace ||
      showHookTrace
    ) {
      return;
    }

    const targetPath = normalizePath(target.filePath);
    const loaded = loadedDataRef.current;
    const sameFileLoaded =
      loaded &&
      normalizePath(loaded.filePath) === targetPath &&
      target.startLine !== undefined;

    if (sameFileLoaded) {
      const nextStart = target.startLine;
      const nextEnd = target.endLine ?? target.startLine;
      if (loaded.startLine === nextStart && loaded.endLine === nextEnd) {
        return;
      }
      setData({
        ...loaded,
        endLine: nextEnd,
        startLine: nextStart,
      });
      return;
    }

    const controller = new AbortController();

    const load = async () => {
      setIsLoading(true);
      setError(null);
      setData(null);

      const params = new URLSearchParams({ filePath: target.filePath });
      if (target.startLine) {
        params.set("startLine", String(target.startLine));
      }
      if (target.endLine) {
        params.set("endLine", String(target.endLine));
      }
      if (target.symbolName) {
        params.set("symbolName", target.symbolName);
      }
      if (target.parentFilePath) {
        params.set("parentFilePath", target.parentFilePath);
      }
      if (target.searchText) {
        params.set("searchText", target.searchText);
      }

      try {
        const response = await fetch(`/api/source?${params.toString()}`, {
          signal: controller.signal,
        });
        const payload = (await response.json()) as SourceResponse & {
          error?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to load source");
        }

        setData(payload);
      } catch (loadError) {
        if (controller.signal.aborted) {
          return;
        }
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load source"
        );
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    void load();

    return () => {
      controller.abort();
    };
  }, [open, showHookTrace, showPropTrace, showVariableTrace, target]);

  useEffect(() => {
    if (
      !data?.startLine ||
      showPropTrace ||
      showVariableTrace ||
      showHookTrace
    ) {
      return;
    }

    const container = scrollContainerRef.current;
    const highlight = highlightRef.current;
    if (!container || !highlight) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      const offset =
        highlight.offsetTop -
        container.clientHeight / 2 +
        highlight.clientHeight / 2;
      container.scrollTop = Math.max(0, offset);
    });

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [data, showHookTrace, showPropTrace, showVariableTrace]);

  if (!open) {
    return null;
  }

  const lines = data?.content.split("\n") ?? [];
  const showDataTrace = Boolean(
    !showPropTrace &&
    !showVariableTrace &&
    !showHookTrace &&
    traceLevel === "component" &&
    trace &&
    trace.steps.length > 0 &&
    onTraceStepFocus
  );
  const drawerTitle = showPropTrace
    ? `Prop trace · ${propTrace!.propName}`
    : showVariableTrace
      ? `Variable trace · ${variableTrace!.variableName}`
      : showHookTrace
        ? `Hook trace · ${hookTrace!.hookName}()`
        : showDataTrace
          ? TRACE_DRAWER_TITLES.component
          : TRACE_DRAWER_TITLES.route;

  return (
    <div className="fixed inset-0 z-50 flex justify-end overscroll-none">
      <button
        aria-label="Close source viewer"
        className="absolute inset-0 bg-black/30"
        onClick={onClose}
        type="button"
      />
      <aside
        className={[
          "relative z-10 flex h-full w-full flex-col overscroll-contain border-s bg-background shadow-2xl",
          showPropTrace || showVariableTrace || showHookTrace || showDataTrace
            ? "max-w-[min(96rem,100vw)]"
            : "max-w-3xl",
        ].join(" ")}
        onWheel={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold">{drawerTitle}</p>
            {showPropTrace ? (
              <p className="truncate text-xs text-muted-foreground">
                {graph?.nodes.find(
                  (node) => node.id === propTrace!.consumerNodeId
                )?.label ?? propTrace!.consumerNodeId}
              </p>
            ) : null}
            {showVariableTrace ? (
              <p className="truncate text-xs text-muted-foreground">
                {graph?.nodes.find(
                  (node) => node.id === variableTrace!.consumerNodeId
                )?.label ?? variableTrace!.consumerNodeId}
              </p>
            ) : null}
            {showHookTrace ? (
              <p className="truncate text-xs text-muted-foreground">
                {hookTraceContext?.consumerNodeId
                  ? (graph?.nodes.find(
                      (node) => node.id === hookTraceContext.consumerNodeId
                    )?.label ?? hookTraceContext.consumerNodeId)
                  : hookTrace!.hookName}
              </p>
            ) : null}
            {!showPropTrace &&
            !showVariableTrace &&
            !showHookTrace &&
            target?.label ? (
              <p className="truncate text-xs text-muted-foreground">
                {target.label}
              </p>
            ) : null}
            {!showPropTrace &&
            !showVariableTrace &&
            !showHookTrace &&
            target?.filePath ? (
              <p className="truncate font-mono text-xs text-muted-foreground">
                {target.filePath}
              </p>
            ) : null}
          </div>
          <button
            className="shrink-0 rounded-md border px-2 py-1 text-xs hover:bg-muted"
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </header>

        {showPropTrace && graph && propTrace ? (
          <div className="flex min-h-0 flex-1 flex-col p-3">
            <PropsTraceViewer
              embedded
              focusNodeId={propTrace.consumerNodeId}
              graph={graph}
              initialPropName={propTrace.propName}
            />
          </div>
        ) : showVariableTrace && graph && variableTrace ? (
          <div className="flex min-h-0 flex-1 flex-col p-3">
            <VariableTraceViewer
              embedded
              focusNodeId={variableTrace.consumerNodeId}
              graph={graph}
              initialVariableName={variableTrace.variableName}
            />
          </div>
        ) : showHookTrace && hookTrace ? (
          <div className="flex min-h-0 flex-1 flex-col p-3">
            <HookTraceViewer
              consumerLabel={
                hookTraceContext?.consumerNodeId
                  ? graph?.nodes.find(
                      (node) => node.id === hookTraceContext.consumerNodeId
                    )?.label
                  : undefined
              }
              consumerNodeId={hookTraceContext?.consumerNodeId}
              embedded
              graph={graph ?? undefined}
              onSelectHook={onTraceHook}
              trace={hookTrace}
            />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1">
            {showDataTrace && trace && onTraceStepFocus ? (
              <DataTraceSidebar
                focusedStepId={focusedTraceStepId}
                onStepFocus={onTraceStepFocus}
                onTraceHook={onTraceHook}
                trace={trace}
              />
            ) : null}

            <div
              className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain bg-muted/20"
              ref={scrollContainerRef}
            >
              {!target && sourceNotice ? (
                <p className="p-4 text-sm text-amber-800 dark:text-amber-200">
                  {sourceNotice}
                </p>
              ) : null}

              {!target && !sourceNotice ? (
                <p className="p-4 text-xs text-muted-foreground">
                  No source file selected.
                </p>
              ) : null}

              {target && isLoading ? (
                <div className="space-y-2 p-4">
                  {Array.from({ length: 12 }).map((_, index) => (
                    <div
                      className="h-4 animate-pulse rounded bg-muted"
                      key={index}
                      style={{ width: `${60 + (index % 4) * 10}%` }}
                    />
                  ))}
                </div>
              ) : null}

              {target && error ? (
                <p className="p-4 text-sm text-destructive">{error}</p>
              ) : null}

              {target && !isLoading && !error && data ? (
                <pre className="p-0 text-xs leading-5">
                  <code>
                    {lines.map((line, index) => {
                      const lineNumber = index + 1;
                      const highlighted = isLineHighlighted(
                        lineNumber,
                        data.startLine,
                        data.endLine
                      );
                      return (
                        <div
                          className={[
                            "flex",
                            highlighted
                              ? "bg-amber-500/15 ring-1 ring-inset ring-amber-500/30"
                              : "hover:bg-muted/40",
                          ].join(" ")}
                          key={lineNumber}
                          ref={
                            highlighted && lineNumber === data.startLine
                              ? highlightRef
                              : undefined
                          }
                        >
                          <span className="w-12 shrink-0 select-none border-e bg-muted/50 px-2 py-0.5 text-end font-mono text-[10px] text-muted-foreground">
                            {lineNumber}
                          </span>
                          <span className="min-w-0 flex-1 whitespace-pre px-3 py-0.5 font-mono">
                            {line || " "}
                          </span>
                        </div>
                      );
                    })}
                  </code>
                </pre>
              ) : null}
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
