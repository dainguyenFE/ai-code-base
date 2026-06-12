import { WorkspaceProvider } from "../../../../context/WorkspaceProvider";
import { getProjectById } from "../../../../lib/creative-studio/getProjects";

interface ProjectLayoutProps {
  children: React.ReactNode;
  params: { locale: string; projectId: string };
}

/** Level 10 route — project-scoped layout with enriched context */
export default function ProjectLayout({
  children,
  params,
}: ProjectLayoutProps) {
  const project = getProjectById(params.projectId);

  return (
    <WorkspaceProvider
      locale={params.locale}
      projectId={params.projectId}
      projectName={project?.name ?? "Unknown"}
    >
      <div data-slot="project-layout" data-project={params.projectId}>
        {children}
      </div>
    </WorkspaceProvider>
  );
}
