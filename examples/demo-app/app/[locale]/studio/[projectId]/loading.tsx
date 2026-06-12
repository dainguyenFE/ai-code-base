import { Skeleton } from "../../../../components/ui/skeleton";

/** Level 10 route — loading UI for project editor */
export default function ProjectLoading() {
  return (
    <div data-slot="project-loading">
      <Skeleton />
      <p>Loading workspace…</p>
    </div>
  );
}
