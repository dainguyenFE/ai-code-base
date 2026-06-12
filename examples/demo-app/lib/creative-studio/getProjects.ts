export interface StudioProject {
  id: string;
  name: string;
  description: string;
  layerCount: number;
  updatedAt: string;
}

/** Server-side data layer for studio routes */
export function getProjects(): StudioProject[] {
  return [
    {
      description: "Landing page hero section",
      id: "proj-hero",
      layerCount: 4,
      name: "Hero Banner",
      updatedAt: "2026-06-01",
    },
    {
      description: "Product card grid layout",
      id: "proj-cards",
      layerCount: 7,
      name: "Product Cards",
      updatedAt: "2026-06-05",
    },
    {
      description: "Mobile navigation drawer",
      id: "proj-nav",
      layerCount: 3,
      name: "Mobile Nav",
      updatedAt: "2026-06-08",
    },
  ];
}

export function getProjectById(id: string): StudioProject | null {
  return getProjects().find((project) => project.id === id) ?? null;
}
