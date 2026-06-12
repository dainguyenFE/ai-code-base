"use client";

import { useMemo } from "react";

import { useWorkspaceContext } from "../context/WorkspaceProvider";
import { useWorkspaceStore } from "../stores/useWorkspaceStore";
import { useDebouncedValue } from "./useDebouncedValue";
import { useIsMobile } from "./useIsMobile";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";
import { useLayerSelection } from "./useLayerSelection";

/** Level 9 — orchestrates context, Zustand, and composed hooks */
export function useWorkspace() {
  const ctx = useWorkspaceContext();
  const isMobile = useIsMobile();
  const layerSelection = useLayerSelection();

  const selectedTool = useWorkspaceStore((state) => state.selectedTool);
  const zoom = useWorkspaceStore((state) => state.zoom);
  const selectTool = useWorkspaceStore((state) => state.selectTool);

  const debouncedZoom = useDebouncedValue(zoom, 150);

  useKeyboardShortcuts(!isMobile);

  const toolbarLabel = useMemo(
    () => `${ctx.projectName} · ${selectedTool} · ${debouncedZoom}%`,
    [ctx.projectName, selectedTool, debouncedZoom]
  );

  return {
    ...ctx,
    ...layerSelection,
    debouncedZoom,
    isMobile,
    selectTool,
    selectedTool,
    toolbarLabel,
    zoom,
  };
}
