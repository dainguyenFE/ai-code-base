"use client";

import type { TraceLayer } from "@cs/page-logic-visualizer/client";

export type LayerFilterPreset =
  | "overview"
  | "data-flow"
  | "interaction"
  | "dependency"
  | "all";

export const LAYER_LABELS: Record<TraceLayer, string> = {
  component: "Component",
  "data-flow": "Data Flow",
  "data-source": "API",
  dependency: "Dependency",
  "event-action": "Event",
  hook: "Hook",
  route: "Route",
  "state-store": "State",
};

const PRESET_LAYERS: Record<LayerFilterPreset, TraceLayer[]> = {
  all: [
    "route",
    "component",
    "hook",
    "data-flow",
    "dependency",
    "data-source",
    "state-store",
    "event-action",
  ],
  "data-flow": ["component", "hook", "data-flow", "data-source"],
  dependency: ["component", "hook", "dependency"],
  interaction: ["component", "event-action", "state-store", "data-source"],
  overview: ["route", "component"],
};

interface LayerFilterBarProps {
  enabledLayers: Set<TraceLayer>;
  preset: LayerFilterPreset;
  onPresetChange: (preset: LayerFilterPreset) => void;
  onToggleLayer: (layer: TraceLayer) => void;
}

export function LayerFilterBar({
  enabledLayers,
  preset,
  onPresetChange,
  onToggleLayer,
}: LayerFilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Layers
      </span>
      <select
        className="rounded-md border bg-background px-2 py-1 text-xs"
        onChange={(event) =>
          onPresetChange(event.target.value as LayerFilterPreset)
        }
        value={preset}
      >
        <option value="overview">Overview</option>
        <option value="data-flow">Data Flow</option>
        <option value="interaction">Interaction</option>
        <option value="dependency">Dependency</option>
        <option value="all">All layers</option>
      </select>
      <div className="flex flex-wrap gap-1">
        {(PRESET_LAYERS.all as TraceLayer[]).map((layer) => (
          <button
            className={[
              "rounded border px-2 py-0.5 text-[10px] font-medium transition-colors",
              enabledLayers.has(layer)
                ? "border-primary bg-primary/10 text-foreground"
                : "border-transparent bg-muted/40 text-muted-foreground",
            ].join(" ")}
            key={layer}
            onClick={() => onToggleLayer(layer)}
            type="button"
          >
            {LAYER_LABELS[layer]}
          </button>
        ))}
      </div>
    </div>
  );
}

export const layersForPreset = (preset: LayerFilterPreset): Set<TraceLayer> =>
  new Set(PRESET_LAYERS[preset]);
