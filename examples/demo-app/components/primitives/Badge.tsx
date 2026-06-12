interface BadgeProps {
  label: string;
}

/** Level 1 — leaf component (no children, no hooks) */
export function Badge({ label }: BadgeProps) {
  return <span data-slot="badge">{label}</span>;
}
