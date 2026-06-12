"use client";

import { StudioToolbar } from "./StudioToolbar";
import { WorkspaceCanvas } from "./WorkspaceCanvas";
import { WorkspaceSidebar } from "./WorkspaceSidebar";

/** Level 9 — main workspace layout shell */
export function WorkspaceShell() {
  return (
    <div data-slot="workspace-shell">
      <StudioToolbar />
      <div data-slot="workspace-body">
        <WorkspaceSidebar />
        <WorkspaceCanvas />
      </div>
    </div>
  );
}
