import type { HTMLAttributes } from "react";

/** shadcn/ui Skeleton stub — UI library boundary */
export function Skeleton({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div data-shadcn="Skeleton" className={className} {...props} />;
}
