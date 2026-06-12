"use client";

import {
  buildAllTraceLayers,
  buildUiTree,
  flattenUiTree,
} from "@cs/page-logic-visualizer/client";
import type {
  PageLogicGraph,
  TraceLayer,
} from "@cs/page-logic-visualizer/client";
import { useMemo } from "react";

import { LAYER_LABELS } from "./LayerFilterBar";

interface ExplorerItem {
  id: string;
  label: string;
  detail?: string;
  layer?: TraceLayer;
  nodeId?: string;
}

interface LeftExplorerProps {
  graph: PageLogicGraph;
  enabledLayers: Set<TraceLayer>;
  selectedRoute: string;
  focusNodeId: string | null;
  onSelectItem: (item: ExplorerItem) => void;
  onSelectLayer: (layer: TraceLayer) => void;
}

const Section = ({
  items,
  onSelect,
  title,
}: {
  items: ExplorerItem[];
  onSelect: (item: ExplorerItem) => void;
  title: string;
}) => {
  if (items.length === 0) {
    return null;
  }
  return (
    <section className="space-y-1">
      <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <ul className="space-y-0.5">
        {items.slice(0, 24).map((item) => (
          <li key={item.id}>
            <button
              className="w-full rounded px-2 py-1 text-start text-xs hover:bg-muted/60"
              onClick={() => onSelect(item)}
              type="button"
            >
              <span className="font-medium">{item.label}</span>
              {item.detail ? (
                <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground">
                  {item.detail}
                </span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
};

export function LeftExplorer({
  graph,
  enabledLayers,
  selectedRoute,
  focusNodeId,
  onSelectItem,
  onSelectLayer,
}: LeftExplorerProps) {
  const sections = useMemo(() => {
    const layers = buildAllTraceLayers(graph);
    const uiTree = buildUiTree(graph);
    const flat = uiTree ? flattenUiTree(uiTree) : [];

    const routes: ExplorerItem[] = (graph.routeChain ?? []).map((entry) => ({
      detail: entry.filePath,
      id: entry.nodeId,
      label: entry.label,
      layer: "route",
      nodeId: entry.nodeId,
    }));

    const components: ExplorerItem[] = graph.nodes
      .filter((node) => node.type === "component" || node.type === "page")
      .map((node) => ({
        detail: node.filePath,
        id: node.id,
        label: node.label,
        layer: "component",
        nodeId: node.id,
      }));

    const hooks: ExplorerItem[] = graph.nodes
      .filter((node) => node.type === "hook" && node.hook)
      .map((node) => ({
        detail: node.filePath,
        id: node.id,
        label: node.hook!.hookName,
        layer: "hook",
        nodeId: node.id,
      }));

    const data: ExplorerItem[] = [];
    for (const treeNode of flat) {
      for (const variable of treeNode.locals.variables) {
        data.push({
          detail: variable.expression,
          id: `${treeNode.nodeId}:${variable.name}`,
          label: variable.name,
          layer: "data-flow",
          nodeId: treeNode.nodeId,
        });
      }
    }

    const apis: ExplorerItem[] = layers["data-source"].nodes
      .filter((node) => node.type === "api-call" || node.type === "data-fetch")
      .map((node) => ({
        detail: node.file,
        id: node.id,
        label: node.label,
        layer: "data-source",
      }));

    const events: ExplorerItem[] = layers["event-action"].nodes
      .filter((node) => node.type === "event-handler")
      .map((node) => ({
        detail: node.file,
        id: node.id,
        label: node.label,
        layer: "event-action",
      }));

    return { apis, components, data, events, hooks, routes };
  }, [graph]);

  return (
    <aside className="flex h-full flex-col gap-3 overflow-y-auto rounded-lg border bg-card p-3">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Explorer
        </p>
        <p className="font-mono text-xs">{selectedRoute}</p>
        {focusNodeId ? (
          <p className="mt-1 font-mono text-[10px] text-muted-foreground">
            focus: {focusNodeId.slice(0, 24)}…
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-1">
        {([...enabledLayers] as TraceLayer[]).map((layer) => (
          <button
            className="rounded border px-1.5 py-0.5 text-[10px] hover:bg-muted/60"
            key={layer}
            onClick={() => onSelectLayer(layer)}
            type="button"
          >
            {LAYER_LABELS[layer]}
          </button>
        ))}
      </div>

      {enabledLayers.has("route") ? (
        <Section
          items={sections.routes}
          onSelect={onSelectItem}
          title="Route"
        />
      ) : null}
      {enabledLayers.has("component") ? (
        <Section
          items={sections.components}
          onSelect={onSelectItem}
          title="Components"
        />
      ) : null}
      {enabledLayers.has("hook") ? (
        <Section items={sections.hooks} onSelect={onSelectItem} title="Hooks" />
      ) : null}
      {enabledLayers.has("data-flow") ? (
        <Section items={sections.data} onSelect={onSelectItem} title="Data" />
      ) : null}
      {enabledLayers.has("data-source") ? (
        <Section items={sections.apis} onSelect={onSelectItem} title="APIs" />
      ) : null}
      {enabledLayers.has("event-action") ? (
        <Section
          items={sections.events}
          onSelect={onSelectItem}
          title="Events"
        />
      ) : null}
    </aside>
  );
}

export type { ExplorerItem };
