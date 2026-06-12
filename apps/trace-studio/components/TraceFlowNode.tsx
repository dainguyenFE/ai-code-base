"use client";

import { Handle, Position, useViewport } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";

import { NODE_HEIGHT, NODE_WIDTH } from "@/lib/graph-layout";

const NODE_THEME: Record<
  string,
  { bg: string; border: string; subtext: string; text: string }
> = {
  builtin: {
    bg: "#fff8c5",
    border: "#9a6700",
    subtext: "var(--muted)",
    text: "var(--text)",
  },
  component: {
    bg: "var(--node-component-bg)",
    border: "var(--node-component-border)",
    subtext: "var(--muted)",
    text: "var(--text)",
  },
  error: {
    bg: "#ffebe9",
    border: "#cf222e",
    subtext: "var(--muted)",
    text: "var(--text)",
  },
  external: {
    bg: "#ffebe9",
    border: "#cf222e",
    subtext: "var(--muted)",
    text: "var(--text)",
  },
  file: {
    bg: "var(--node-default-bg)",
    border: "var(--node-default-border)",
    subtext: "var(--muted)",
    text: "var(--text)",
  },
  function: {
    bg: "var(--node-function-bg)",
    border: "var(--node-function-border)",
    subtext: "var(--muted)",
    text: "var(--text)",
  },
  hook: {
    bg: "var(--node-hook-bg)",
    border: "var(--node-hook-border)",
    subtext: "var(--muted)",
    text: "var(--text)",
  },
  layout: {
    bg: "#fbefff",
    border: "#8250df",
    subtext: "var(--muted)",
    text: "var(--text)",
  },
  loading: {
    bg: "#fff8c5",
    border: "#9a6700",
    subtext: "var(--muted)",
    text: "var(--text)",
  },
  not_found: {
    bg: "#ffebe9",
    border: "#cf222e",
    subtext: "var(--muted)",
    text: "var(--text)",
  },
  page: {
    bg: "#ddf4ff",
    border: "#0969da",
    subtext: "var(--muted)",
    text: "var(--text)",
  },
  prop: {
    bg: "#ddf4ff",
    border: "#0969da",
    subtext: "var(--muted)",
    text: "#0550ae",
  },
  route: {
    bg: "var(--node-route-bg)",
    border: "var(--node-route-border)",
    subtext: "var(--muted)",
    text: "var(--text)",
  },
  variable: {
    bg: "#f6f8fa",
    border: "#656d76",
    subtext: "var(--muted)",
    text: "var(--text)",
  },
};

function themeForType(type: string) {
  return NODE_THEME[type] ?? NODE_THEME.component;
}

export function TraceFlowNode({ data, selected, width, height }: NodeProps) {
  const { zoom } = useViewport();
  const label = String(data.label ?? "");
  const nodeType = String(data.nodeType ?? "component");
  const badges = Array.isArray(data.badges) ? (data.badges as string[]) : [];
  const isCenter = Boolean(data.isCenter) || Boolean(selected);
  const dimmed = Boolean(data.dimmed);
  const isComponentContext = Boolean(data.isComponentContext);
  const theme = isComponentContext ? NODE_THEME.file : themeForType(nodeType);
  const boxWidth = width ?? NODE_WIDTH;
  const boxHeight = height ?? NODE_HEIGHT;

  const inverseZoom = 1 / zoom;

  return (
    <div
      style={{
        cursor: "grab",
        height: boxHeight,
        opacity: dimmed ? 0.38 : 1,
        position: "relative",
        transition: "opacity 150ms ease",
        width: boxWidth,
      }}
    >
      <div
        style={{
          background: theme.bg,
          border: isCenter
            ? `2px solid var(--node-center-ring)`
            : `1px solid ${theme.border}`,
          borderRadius: 8,
          boxShadow: isCenter
            ? "0 0 0 3px rgba(9, 105, 218, 0.12)"
            : "0 1px 2px rgba(31, 35, 40, 0.06)",
          boxSizing: "border-box",
          height: boxHeight * zoom,
          minHeight: boxHeight * zoom,
          padding: 8 * zoom,
          transform: `scale(${inverseZoom})`,
          transformOrigin: "top left",
          width: boxWidth * zoom,
        }}
      >
        <div
          style={{
            color: theme.text,
            fontSize: 12,
            fontWeight: 600,
            lineHeight: 1.4,
            overflowWrap: "anywhere",
            whiteSpace: "normal",
            wordBreak: "break-word",
          }}
        >
          {label}
        </div>
        {isComponentContext ? null : (
          <div
            style={{
              color: theme.subtext,
              fontSize: 10,
              lineHeight: 1.35,
              marginTop: 4,
            }}
          >
            {nodeType}
          </div>
        )}
        {badges.length > 0 ? (
          <div
            style={{
              color: theme.subtext,
              display: "flex",
              flexWrap: "wrap",
              fontSize: 9,
              gap: 4,
              lineHeight: 1.3,
              marginTop: 6,
            }}
          >
            {badges.map((badge) => (
              <span
                key={badge}
                style={{
                  background: "rgba(31, 35, 40, 0.06)",
                  borderRadius: 4,
                  padding: "1px 4px",
                }}
              >
                {badge}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <Handle
        id="top"
        position={Position.Top}
        style={{ opacity: 0, pointerEvents: "none" }}
        type="target"
      />
      <Handle
        id="bottom"
        position={Position.Bottom}
        style={{ opacity: 0, pointerEvents: "none" }}
        type="source"
      />
      <Handle
        id="left"
        position={Position.Left}
        style={{ opacity: 0, pointerEvents: "none" }}
        type="target"
      />
      <Handle
        id="right"
        position={Position.Right}
        style={{ opacity: 0, pointerEvents: "none" }}
        type="source"
      />
    </div>
  );
}
