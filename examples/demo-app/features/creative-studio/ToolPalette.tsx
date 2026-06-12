"use client";

import { useCallback, useMemo } from "react";

import { Button } from "../../components/ui/button";
import { useWorkspaceStore } from "../../stores/useWorkspaceStore";
import type { WorkspaceState } from "../../stores/useWorkspaceStore";

const TOOLS: WorkspaceState["selectedTool"][] = [
  "select",
  "brush",
  "text",
  "shape",
];

/** Level 8 — useMemo for derived list + useCallback handlers */
export function ToolPalette() {
  const selectedTool = useWorkspaceStore((state) => state.selectedTool);
  const selectTool = useWorkspaceStore((state) => state.selectTool);

  const toolButtons = useMemo(
    () =>
      TOOLS.map((tool) => ({
        isActive: tool === selectedTool,
        label: tool.charAt(0).toUpperCase() + tool.slice(1),
        tool,
      })),
    [selectedTool]
  );

  const handleSelect = useCallback(
    (tool: WorkspaceState["selectedTool"]) => () => selectTool(tool),
    [selectTool]
  );

  return (
    <nav data-slot="tool-palette">
      {toolButtons.map(({ tool, label, isActive }) => (
        <Button
          key={tool}
          size="sm"
          variant={isActive ? "default" : "outline"}
          onClick={handleSelect(tool)}
        >
          {label}
        </Button>
      ))}
    </nav>
  );
}
