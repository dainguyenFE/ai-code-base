"use client";

interface PanelCollapseButtonProps {
  collapsed: boolean;
  edge: "left" | "right";
  onToggle: () => void;
  title: string;
}

export function PanelCollapseButton({
  collapsed,
  edge,
  onToggle,
  title,
}: PanelCollapseButtonProps) {
  const label = collapsed
    ? edge === "left"
      ? "›"
      : "‹"
    : edge === "left"
      ? "‹"
      : "›";

  return (
    <button
      aria-label={title}
      onClick={onToggle}
      style={{
        alignItems: "center",
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderRadius: edge === "left" ? "0 6px 6px 0" : "6px 0 0 6px",
        color: "var(--muted)",
        cursor: "pointer",
        display: "flex",
        flexShrink: 0,
        fontSize: 14,
        height: 48,
        justifyContent: "center",
        padding: 0,
        width: 20,
      }}
      title={title}
      type="button"
    >
      {label}
    </button>
  );
}
