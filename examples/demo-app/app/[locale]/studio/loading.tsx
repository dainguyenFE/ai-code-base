import { Skeleton } from "../../../components/ui/skeleton";

/** Level 9 route — loading UI for studio list */
export default function StudioLoading() {
  return (
    <div data-slot="studio-loading">
      <Skeleton />
      <Skeleton />
      <Skeleton />
    </div>
  );
}
