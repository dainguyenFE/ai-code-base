"use client";

import { useMemo } from "react";

import { Badge } from "../../components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { useWorkspace } from "../../hooks/useWorkspace";

/** Level 8 — consumes useWorkspace orchestrator hook */
export function WorkspaceCanvas() {
  const {
    activeLayer,
    debouncedZoom,
    projectName,
    selectedTool,
    toolbarLabel,
  } = useWorkspace();

  const canvasStyle = useMemo(
    () => ({ transform: `scale(${debouncedZoom / 100})` }),
    [debouncedZoom]
  );

  return (
    <Card data-slot="workspace-canvas">
      <CardHeader>
        <CardTitle>{projectName}</CardTitle>
        <Badge variant="secondary">{toolbarLabel}</Badge>
      </CardHeader>
      <CardContent>
        <div data-tool={selectedTool} style={canvasStyle}>
          {activeLayer ? (
            <p>Editing layer: {activeLayer.name}</p>
          ) : (
            <p>No layer selected</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
