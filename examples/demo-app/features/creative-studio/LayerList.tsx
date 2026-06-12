"use client";

import { useCallback } from "react";

import { Button } from "../../components/ui/button";
import { Separator } from "../../components/ui/separator";
import { useLayerSelection } from "../../hooks/useLayerSelection";
import { useWorkspaceStore } from "../../stores/useWorkspaceStore";
import { LayerItem } from "./LayerItem";

/** Level 8 — list of memoized children + Zustand actions */
export function LayerList() {
  const layers = useWorkspaceStore((state) => state.layers);
  const addLayer = useWorkspaceStore((state) => state.addLayer);
  const toggleLayerLock = useWorkspaceStore((state) => state.toggleLayerLock);
  const toggleLayerVisibility = useWorkspaceStore(
    (state) => state.toggleLayerVisibility
  );
  const { activeLayerId, selectLayer } = useLayerSelection();

  const handleAdd = useCallback(() => {
    addLayer(`Layer ${layers.length + 1}`);
  }, [addLayer, layers.length]);

  return (
    <aside data-slot="layer-list">
      <h3>Layers</h3>
      <Button size="sm" variant="outline" onClick={handleAdd}>
        Add layer
      </Button>
      <Separator />
      {layers.map((layer) => (
        <LayerItem
          key={layer.id}
          isActive={layer.id === activeLayerId}
          layer={layer}
          onSelect={selectLayer}
          onToggleLock={toggleLayerLock}
          onToggleVisibility={toggleLayerVisibility}
        />
      ))}
    </aside>
  );
}
