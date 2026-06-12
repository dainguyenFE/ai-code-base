import { CreativeStudioHome } from "../../../features/creative-studio/CreativeStudioHome";
import { getProjects } from "../../../lib/creative-studio/getProjects";

interface StudioPageProps {
  params: { locale: string };
}

/** Level 9 route — `/[locale]/studio` project list */
export default function StudioPage({ params }: StudioPageProps) {
  const projects = getProjects();

  return <CreativeStudioHome locale={params.locale} projects={projects} />;
}
