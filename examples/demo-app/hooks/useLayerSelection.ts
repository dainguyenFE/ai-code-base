"use client";

import { useCallback, useMemo } from "react";

import { useWorkspaceStore } from "../stores/useWorkspaceStore";

/** Level 8 — composes Zustand + useMemo + useCallback */
export function useLayerSelection() {
  const layers = useWorkspaceStore((state) => state.layers);
  const activeLayerId = useWorkspaceStore((state) => state.activeLayerId);
  const selectLayer = useWorkspaceStore((state) => state.selectLayer);

  const activeLayer = useMemo(
    () => layers.find((layer) => layer.id === activeLayerId) ?? null,
    [layers, activeLayerId]
  );

  const visibleLayers = useMemo(
    () => layers.filter((layer) => layer.visible),
    [layers]
  );

  const selectNext = useCallback(() => {
    if (layers.length === 0) {
      return;
    }
    const index = layers.findIndex((layer) => layer.id === activeLayerId);
    const next = layers[(index + 1) % layers.length];
    if (next) {
      selectLayer(next.id);
    }
  }, [layers, activeLayerId, selectLayer]);

  const selectPrevious = useCallback(() => {
    if (layers.length === 0) {
      return;
    }
    const index = layers.findIndex((layer) => layer.id === activeLayerId);
    const prev = layers[(index - 1 + layers.length) % layers.length];
    if (prev) {
      selectLayer(prev.id);
    }
  }, [layers, activeLayerId, selectLayer]);

  return {
    activeLayer,
    activeLayerId,
    selectLayer,
    selectNext,
    selectPrevious,
    visibleLayers,
  };
}
