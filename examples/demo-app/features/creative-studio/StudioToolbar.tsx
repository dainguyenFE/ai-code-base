"use client";

import { useCallback } from "react";

import { Button } from "../../components/ui/button";
import { Separator } from "../../components/ui/separator";
import { useWorkspaceContext } from "../../context/WorkspaceProvider";
import { useWorkspace } from "../../hooks/useWorkspace";
import { useWorkspaceStore } from "../../stores/useWorkspaceStore";

/** Level 8 — context + Zustand + composed hook */
export function StudioToolbar() {
  const { resetWorkspace } = useWorkspaceContext();
  const { isMobile, toolbarLabel, zoom } = useWorkspace();
  const setZoom = useWorkspaceStore((state) => state.setZoom);

  const zoomIn = useCallback(() => setZoom(zoom + 10), [setZoom, zoom]);
  const zoomOut = useCallback(() => setZoom(zoom - 10), [setZoom, zoom]);

  return (
    <header data-slot="studio-toolbar">
      <span>{toolbarLabel}</span>
      {isMobile ? <BadgeCompact /> : null}
      <Separator />
      <Button size="sm" variant="outline" onClick={zoomOut}>
        −
      </Button>
      <span>{zoom}%</span>
      <Button size="sm" variant="outline" onClick={zoomIn}>
        +
      </Button>
      <Button size="sm" variant="ghost" onClick={resetWorkspace}>
        Reset
      </Button>
    </header>
  );
}

function BadgeCompact() {
  return <span data-slot="mobile-badge">Mobile</span>;
}
