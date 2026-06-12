"use client";

import type { ReactNode } from "react";
import { useState } from "react";

interface CollapsibleNodePanelProps {
  title: string;
  subtitle?: string;
  badge?: string;
  defaultCollapsed?: boolean;
  children: ReactNode;
}

export function CollapsibleNodePanel({
  badge,
  children,
  defaultCollapsed = true,
  subtitle,
  title,
}: CollapsibleNodePanelProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <div
      className={[
        "flex flex-col overflow-hidden rounded-lg border bg-card transition-[max-height]",
        collapsed ? "max-h-12" : "max-h-[50vh]",
      ].join(" ")}
    >
      <button
        aria-expanded={!collapsed}
        className="flex w-full shrink-0 items-center gap-2 border-b bg-muted/30 px-4 py-3 text-start text-sm hover:bg-muted/50"
        onClick={() => setCollapsed((current) => !current)}
        type="button"
      >
        <span className="flex size-5 shrink-0 items-center justify-center rounded border bg-background font-mono text-xs">
          {collapsed ? "▲" : "▼"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="font-semibold">{title}</span>
          {subtitle ? (
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {subtitle}
            </span>
          ) : null}
        </span>
        {badge ? (
          <span className="shrink-0 rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {badge}
          </span>
        ) : null}
      </button>

      {!collapsed ? (
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      ) : null}
    </div>
  );
}
