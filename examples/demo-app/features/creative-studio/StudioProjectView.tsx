"use client";

import type { StudioProject } from "../../lib/creative-studio/getProjects";
import { WorkspaceShell } from "./WorkspaceShell";

interface StudioProjectViewProps {
  project: StudioProject;
}

/** Level 9 — project editor entry (client boundary) */
export function StudioProjectView({ project }: StudioProjectViewProps) {
  return (
    <div data-slot="studio-project-view" data-project={project.id}>
      <WorkspaceShell />
    </div>
  );
}
