"use client";

import { useEffect, useRef } from "react";

import { useWorkspaceStore } from "../stores/useWorkspaceStore";
import { useLayerSelection } from "./useLayerSelection";

/** Level 8 — useEffect + useRef for keyboard shortcuts */
export function useKeyboardShortcuts(enabled = true) {
  const setZoom = useWorkspaceStore((state) => state.setZoom);
  const zoom = useWorkspaceStore((state) => state.zoom);
  const { selectNext, selectPrevious } = useLayerSelection();
  const enabledRef = useRef(enabled);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!enabledRef.current) {
        return;
      }

      if (event.key === "]") {
        event.preventDefault();
        selectNext();
        return;
      }

      if (event.key === "[") {
        event.preventDefault();
        selectPrevious();
        return;
      }

      if (event.key === "=" || event.key === "+") {
        event.preventDefault();
        setZoom(zoom + 10);
        return;
      }

      if (event.key === "-") {
        event.preventDefault();
        setZoom(zoom - 10);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectNext, selectPrevious, setZoom, zoom]);
}
