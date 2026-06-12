"use client";

import { memo, useCallback } from "react";

import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import type { WorkspaceLayer } from "../../stores/useWorkspaceStore";

interface LayerItemProps {
  layer: WorkspaceLayer;
  isActive: boolean;
  onSelect: (id: string) => void;
  onToggleLock: (id: string) => void;
  onToggleVisibility: (id: string) => void;
}

/** Level 8 — memo + useCallback + shadcn Button/Badge */
export const LayerItem = memo(
  ({
    layer,
    isActive,
    onSelect,
    onToggleLock,
    onToggleVisibility,
  }: LayerItemProps) => {
    const handleSelect = useCallback(() => {
      onSelect(layer.id);
    }, [layer.id, onSelect]);

    return (
      <div data-active={isActive} data-slot="layer-item">
        <button type="button" onClick={handleSelect}>
          {layer.name}
        </button>
        {!layer.visible ? <Badge variant="outline">hidden</Badge> : null}
        {layer.locked ? <Badge variant="secondary">locked</Badge> : null}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onToggleVisibility(layer.id)}
        >
          👁
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onToggleLock(layer.id)}
        >
          🔒
        </Button>
      </div>
    );
  }
);
