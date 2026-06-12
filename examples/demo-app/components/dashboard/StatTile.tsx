import { useToggle } from "../../hooks/useToggle";
import { Badge } from "../primitives/Badge";

interface StatTileProps {
  label: string;
  value: number;
}

/** Level 3 — leaf + one hook */
export function StatTile({ label, value }: StatTileProps) {
  const { on: highlighted, toggle } = useToggle(false);

  return (
    <button type="button" data-slot="stat-tile" onClick={toggle}>
      <Badge label={label} />
      <strong>{value}</strong>
      {highlighted ? <span>Highlighted</span> : null}
    </button>
  );
}
