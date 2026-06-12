import { Button } from "../../components/ui/button";
import { Separator } from "../../components/ui/separator";
import type { StudioProject } from "../../lib/creative-studio/getProjects";
import { ProjectGrid } from "./ProjectGrid";

interface CreativeStudioHomeProps {
  locale: string;
  projects: StudioProject[];
}

/** Level 9 — studio landing (server component using shadcn UI) */
export function CreativeStudioHome({
  locale,
  projects,
}: CreativeStudioHomeProps) {
  return (
    <main data-slot="creative-studio-home">
      <header>
        <h1>Creative Studio</h1>
        <p>Complex trace demo — context, Zustand, hooks, nested layouts</p>
        <Button variant="outline">New project</Button>
      </header>
      <Separator />
      <ProjectGrid locale={locale} projects={projects} />
    </main>
  );
}
