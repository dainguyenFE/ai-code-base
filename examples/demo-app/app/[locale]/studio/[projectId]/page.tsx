import { StudioProjectView } from "../../../../features/creative-studio/StudioProjectView";
import { getProjectById } from "../../../../lib/creative-studio/getProjects";

interface ProjectPageProps {
  params: { locale: string; projectId: string };
}

/** Level 10 route — `/[locale]/studio/[projectId]` editor */
export default function ProjectPage({ params }: ProjectPageProps) {
  const project = getProjectById(params.projectId);

  if (!project) {
    return null;
  }

  return <StudioProjectView project={project} />;
}
