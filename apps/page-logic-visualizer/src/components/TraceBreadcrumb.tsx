"use client";

import type { PageLogicGraph } from "@cs/page-logic-visualizer/client";
import type { UiTreeNode } from "@cs/page-logic-visualizer/client";
import { Fragment } from "react";

export type TraceViewMode = "route" | "component";

interface TraceBreadcrumbProps {
  graph: PageLogicGraph;
  selectedRoute: string;
  viewMode: TraceViewMode;
  innerPath?: UiTreeNode[];
  onSelectRoute: () => void;
  onSelectLayouts: () => void;
  onSelectPage: () => void;
  onNavigateInner?: (nodeId: string) => void;
}

type Crumb =
  | { id: "route"; label: string; active: boolean }
  | { id: "layouts"; label: string; active: boolean }
  | { id: "page"; label: string; active: boolean }
  | { id: "inner"; label: string; active: boolean; nodeId: string };

export function TraceBreadcrumb({
  graph,
  selectedRoute,
  viewMode,
  innerPath = [],
  onSelectRoute,
  onSelectLayouts,
  onSelectPage,
  onNavigateInner,
}: TraceBreadcrumbProps) {
  const routeEntry = graph.routeChain?.find((entry) => entry.kind === "route");
  const pageEntry = graph.routeChain?.find((entry) => entry.kind === "page");
  const layoutCount =
    graph.routeChain?.filter((entry) => entry.kind === "layout").length ?? 0;

  const routeLabel = routeEntry?.label ?? selectedRoute;
  const pageLabel = pageEntry?.label ?? "Page";
  const layoutLabel = layoutCount > 0 ? "Layout.." : null;

  const crumbs: Crumb[] = [];

  if (viewMode === "route") {
    crumbs.push({ active: true, id: "route", label: routeLabel });
  } else {
    crumbs.push({ active: false, id: "route", label: routeLabel });

    if (layoutLabel) {
      crumbs.push({ active: false, id: "layouts", label: layoutLabel });
    }

    crumbs.push({
      active: viewMode === "component" && innerPath.length === 0,
      id: "page",
      label: pageLabel,
    });

    for (const [index, item] of innerPath.entries()) {
      crumbs.push({
        active: viewMode === "component" && index === innerPath.length - 1,
        id: "inner",
        label: item.node.label,
        nodeId: item.nodeId,
      });
    }
  }

  const handleClick = (crumb: Crumb) => {
    if (crumb.active) {
      return;
    }
    switch (crumb.id) {
      case "route": {
        onSelectRoute();
        break;
      }
      case "layouts": {
        onSelectLayouts();
        break;
      }
      case "page": {
        onSelectPage();
        break;
      }
      case "inner": {
        onNavigateInner?.(crumb.nodeId);
        break;
      }
      default: {
        break;
      }
    }
  };

  return (
    <nav
      aria-label="Trace path"
      className="flex flex-wrap items-center gap-1 rounded-lg border bg-card px-3 py-2 text-sm"
    >
      {crumbs.map((crumb, index) => {
        const isLast = index === crumbs.length - 1;
        return (
          <Fragment key={`${crumb.id}-${crumb.label}-${index}`}>
            {index > 0 ? (
              <span aria-hidden className="text-muted-foreground">
                /
              </span>
            ) : null}
            <button
              className={[
                "max-w-[14rem] truncate rounded px-1 py-0.5 text-start transition-colors",
                isLast && crumb.active
                  ? "cursor-default font-semibold text-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              ].join(" ")}
              disabled={isLast && crumb.active}
              onClick={() => handleClick(crumb)}
              title={crumb.label}
              type="button"
            >
              {crumb.label}
            </button>
          </Fragment>
        );
      })}
    </nav>
  );
}
