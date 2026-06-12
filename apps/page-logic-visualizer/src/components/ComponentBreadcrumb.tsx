"use client";

import type { UiTreeNode } from "@cs/page-logic-visualizer/client";
import { Fragment } from "react";

interface ComponentBreadcrumbProps {
  path: UiTreeNode[];
  onNavigate: (nodeId: string) => void;
}

export function ComponentBreadcrumb({
  path,
  onNavigate,
}: ComponentBreadcrumbProps) {
  if (path.length === 0) {
    return null;
  }

  return (
    <nav
      aria-label="Component path"
      className="flex flex-wrap items-center gap-1 rounded-lg border bg-card px-3 py-2 text-sm"
    >
      {path.map((item, index) => {
        const isLast = index === path.length - 1;
        return (
          <Fragment key={item.nodeId}>
            {index > 0 ? (
              <span aria-hidden className="text-muted-foreground">
                /
              </span>
            ) : null}
            <button
              className={[
                "max-w-[14rem] truncate rounded px-1 py-0.5 text-start transition-colors",
                isLast
                  ? "cursor-default font-semibold text-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              ].join(" ")}
              disabled={isLast}
              onClick={() => onNavigate(item.nodeId)}
              title={item.node.label}
              type="button"
            >
              {item.node.label}
            </button>
          </Fragment>
        );
      })}
    </nav>
  );
}
