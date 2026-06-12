interface IconProps {
  name: "star" | "check";
}

/** Level 1 — leaf component (inline SVG, no hooks) */
export function Icon({ name }: IconProps) {
  if (name === "star") {
    return (
      <svg
        data-slot="icon"
        aria-hidden
        viewBox="0 0 16 16"
        width={16}
        height={16}
      >
        <path d="M8 1.5l1.8 3.7 4 .6-2.9 2.8.7 4-3.6-1.9-3.6 1.9.7-4L2.2 5.8l4-.6L8 1.5z" />
      </svg>
    );
  }

  return (
    <svg
      data-slot="icon"
      aria-hidden
      viewBox="0 0 16 16"
      width={16}
      height={16}
    >
      <path d="M3 8.5l3 3 7-7" stroke="currentColor" fill="none" />
    </svg>
  );
}
