"use client";

import { LayerList } from "./LayerList";
import { ToolPalette } from "./ToolPalette";

/** Level 8 — sidebar composition */
export function WorkspaceSidebar() {
  return (
    <aside data-slot="workspace-sidebar">
      <ToolPalette />
      <LayerList />
    </aside>
  );
}
