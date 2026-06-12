"use client";

import { useEffect, useRef, useState } from "react";

import type { SourceViewTarget } from "@/lib/sourceView";

interface SourceResponse {
  content: string;
  filePath: string;
  startLine?: number;
  endLine?: number;
  totalLines: number;
  error?: string;
}

interface SourceCodePanelProps {
  target: SourceViewTarget | null;
  sourceNotice?: string | null;
  className?: string;
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

export function SourceCodePanel({
  target,
  sourceNotice,
  className = "",
}: SourceCodePanelProps) {
  const [data, setData] = useState<SourceResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const loadedDataRef = useRef<SourceResponse | null>(null);

  useEffect(() => {
    loadedDataRef.current = data;
  }, [data]);

  useEffect(() => {
    if (!target) {
      setData(null);
      setError(null);
      setIsLoading(false);
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
  }, [target]);

  useEffect(() => {
    if (!data?.startLine) {
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
  }, [data]);

  const lines = data?.content.split("\n") ?? [];

  return (
    <div
      className={`min-h-0 overflow-y-auto overscroll-contain bg-muted/20 ${className}`}
      ref={scrollContainerRef}
    >
      {!target && sourceNotice ? (
        <p className="p-4 text-sm text-amber-800 dark:text-amber-200">
          {sourceNotice}
        </p>
      ) : null}

      {!target && !sourceNotice ? (
        <p className="p-4 text-xs text-muted-foreground">
          Select a trace step to view source.
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
  );
}
