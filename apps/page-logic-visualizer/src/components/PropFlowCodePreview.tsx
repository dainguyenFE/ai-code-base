"use client";

import { memo } from "react";

interface PropFlowCodePreviewProps {
  text: string;
  className?: string;
}

function PropFlowCodePreviewComponent({
  text,
  className = "",
}: PropFlowCodePreviewProps) {
  return (
    <p
      className={[
        "truncate font-mono leading-snug text-foreground/90",
        className,
      ].join(" ")}
      title={text}
    >
      {text}
    </p>
  );
}

export const PropFlowCodePreview = memo(PropFlowCodePreviewComponent);
