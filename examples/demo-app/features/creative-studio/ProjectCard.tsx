"use client";

import { memo } from "react";

import { Badge } from "../../components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import type { StudioProject } from "../../lib/creative-studio/getProjects";

interface ProjectCardProps {
  project: StudioProject;
  locale: string;
}

/** Level 8 — memo + shadcn Card/Badge (library boundary) */
export const ProjectCard = memo(({ project, locale }: ProjectCardProps) => (
  <Card data-slot="project-card">
    <CardHeader>
      <CardTitle>{project.name}</CardTitle>
      <Badge variant="outline">{project.layerCount} layers</Badge>
    </CardHeader>
    <CardContent>
      <p>{project.description}</p>
      <p>Updated: {project.updatedAt}</p>
      <a href={`/${locale}/studio/${project.id}`}>Open project →</a>
    </CardContent>
  </Card>
));
