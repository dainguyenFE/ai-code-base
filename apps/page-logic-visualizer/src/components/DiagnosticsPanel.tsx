"use client";

import type { AnalyzerWarning } from "@cs/page-logic-visualizer/client";
import { useMemo, useState } from "react";

interface DiagnosticsPanelProps {
  warnings: AnalyzerWarning[];
  onSelectWarning?: (warning: AnalyzerWarning) => void;
}

const levelStyles: Record<string, string> = {
  COMPONENT_NOT_FOUND: "text-destructive",
  FILE_NOT_FOUND: "text-destructive",
  MAX_DEPTH_REACHED: "text-amber-700",
  NO_DEFAULT_EXPORT_FOUND: "text-destructive",
  ROUTE_NOT_FOUND: "text-destructive",
  TS_CONFIG_PATH_NOT_FOUND: "text-destructive",
  UNRESOLVED_IMPORT: "text-amber-700",
};

const CODE_HINTS: Record<string, string> = {
  MAX_DEPTH_REACHED:
    "Analysis stopped at max depth — expand manually or raise depth.",
  UNRESOLVED_IMPORT:
    "Workspace import could not be resolved (relative path, @/ alias, or @scope/package).",
};

export function DiagnosticsPanel({
  warnings,
  onSelectWarning,
}: DiagnosticsPanelProps) {
  const [open, setOpen] = useState(false);

  const grouped = useMemo(() => {
    const map = new Map<string, AnalyzerWarning[]>();
    for (const warning of warnings) {
      const list = map.get(warning.code) ?? [];
      list.push(warning);
      map.set(warning.code, list);
    }
    return [...map.entries()].toSorted(([a], [b]) => a.localeCompare(b));
  }, [warnings]);

  const hasWarnings = warnings.length > 0;

  return (
    <div className="fixed bottom-4 end-4 z-40 flex flex-col items-end gap-2">
      {open ? (
        <div
          className="flex w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border bg-background shadow-lg"
          role="dialog"
          aria-label="Diagnostics"
        >
          <div className="flex items-center justify-between border-b px-3 py-2">
            <div>
              <p className="text-xs font-semibold">Diagnostics</p>
              <p className="text-[10px] text-muted-foreground">
                Workspace imports &amp; analysis limits
              </p>
            </div>
            <button
              className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted/60"
              onClick={() => setOpen(false)}
              type="button"
            >
              Close
            </button>
          </div>

          {hasWarnings ? (
            <ul className="max-h-72 divide-y overflow-y-auto">
              {grouped.flatMap(([code, items]) =>
                items.map((warning, index) => (
                  <li key={`${warning.code}-${warning.filePath}-${index}`}>
                    <button
                      className="flex w-full items-start gap-2 px-3 py-2 text-start text-xs hover:bg-muted/50"
                      onClick={() => onSelectWarning?.(warning)}
                      type="button"
                    >
                      <span
                        className={
                          levelStyles[warning.code] ?? "text-muted-foreground"
                        }
                      >
                        {warning.code}
                      </span>
                      <span className="min-w-0 flex-1 text-foreground">
                        {warning.message}
                        {CODE_HINTS[warning.code] ? (
                          <span className="mt-0.5 block text-[10px] text-muted-foreground">
                            {CODE_HINTS[warning.code]}
                          </span>
                        ) : null}
                      </span>
                      {warning.filePath ? (
                        <span className="max-w-[9rem] shrink-0 truncate font-mono text-[10px] text-muted-foreground">
                          {warning.filePath.split("/").slice(-2).join("/")}
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))
              )}
            </ul>
          ) : (
            <p className="px-3 py-4 text-xs text-muted-foreground">
              No issues — workspace imports resolved and analysis completed
              within limits.
            </p>
          )}
        </div>
      ) : null}

      <button
        aria-expanded={open}
        aria-label={`Diagnostics, ${warnings.length} warnings`}
        className={[
          "relative flex items-center gap-2 rounded-full border bg-background px-4 py-2.5 text-xs font-medium shadow-md transition-colors hover:bg-muted/60",
          open ? "ring-2 ring-ring ring-offset-2 ring-offset-background" : "",
        ].join(" ")}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        Diagnostics
        <span
          className={[
            "flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-semibold tabular-nums",
            hasWarnings
              ? "bg-amber-500/15 text-amber-800"
              : "bg-muted text-muted-foreground",
          ].join(" ")}
        >
          {warnings.length}
        </span>
      </button>
    </div>
  );
}
