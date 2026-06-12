import type { StudioProject } from "../../lib/creative-studio/getProjects";
import { ProjectCard } from "./ProjectCard";

interface ProjectGridProps {
  projects: StudioProject[];
  locale: string;
}

/** Level 8 — server-friendly grid of client cards */
export function ProjectGrid({ projects, locale }: ProjectGridProps) {
  return (
    <section data-slot="project-grid">
      <h2>Projects</h2>
      <div>
        {projects.map((project) => (
          <ProjectCard key={project.id} locale={locale} project={project} />
        ))}
      </div>
    </section>
  );
}
