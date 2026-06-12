import { Badge } from "../primitives/Badge";
import { Icon } from "../primitives/Icon";

interface InfoCardProps {
  title: string;
  badge: string;
}

/** Level 2 — composes leaf components (Badge + Icon) */
export function InfoCard({ title, badge }: InfoCardProps) {
  return (
    <article data-slot="info-card">
      <Icon name="star" />
      <h2>{title}</h2>
      <Badge label={badge} />
    </article>
  );
}
