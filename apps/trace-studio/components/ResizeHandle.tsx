"use client";

import { useCallback, useEffect, useRef } from "react";

interface ResizeHandleProps {
  axis: "horizontal" | "vertical";
  onResize: (delta: number) => void;
}

export function ResizeHandle({ axis, onResize }: ResizeHandleProps) {
  const dragging = useRef(false);
  const lastPos = useRef(0);

  const onMouseDown = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      dragging.current = true;
      lastPos.current = axis === "horizontal" ? event.clientX : event.clientY;
    },
    [axis]
  );

  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      if (!dragging.current) {
        return;
      }

      const pos = axis === "horizontal" ? event.clientX : event.clientY;
      const delta = pos - lastPos.current;
      lastPos.current = pos;
      onResize(delta);
    };

    const onMouseUp = () => {
      dragging.current = false;
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [axis, onResize]);

  const isHorizontal = axis === "horizontal";

  return (
    <div
      onMouseDown={onMouseDown}
      role="separator"
      style={{
        background: "transparent",
        cursor: isHorizontal ? "col-resize" : "row-resize",
        flexShrink: 0,
        height: isHorizontal ? "100%" : 6,
        position: "relative",
        width: isHorizontal ? 6 : "100%",
        zIndex: 2,
      }}
      title="Drag to resize"
    >
      <div
        style={{
          background: "var(--border)",
          borderRadius: 3,
          height: isHorizontal ? "100%" : 2,
          left: isHorizontal ? "50%" : 0,
          position: "absolute",
          top: isHorizontal ? 0 : "50%",
          transform: isHorizontal ? "translateX(-50%)" : "translateY(-50%)",
          width: isHorizontal ? 2 : "100%",
        }}
      />
    </div>
  );
}
