"use client";

import { useMemo, useState } from "react";

import type { InspectorItem, TraceNode } from "@/lib/types";

import { ExecutionTimeline } from "./ExecutionTimeline";

type InspectorTab = "props" | "data" | "hooks" | "children";

interface ComponentInspectorProps {
  node?: TraceNode;
  onHighlightLine?: (line: number | undefined) => void;
  onItemClick?: (item: InspectorItem) => void;
  onSelectChild?: (childId: string) => void;
  scope: string;
  selectedItemId?: string;
}

function ClickableList({
  empty,
  items,
  onItemClick,
  selectedItemId,
}: {
  title?: string;
  items: InspectorItem[];
  empty: string;
  onItemClick?: (item: InspectorItem) => void;
  selectedItemId?: string;
}) {
  if (items.length === 0) {
    return (
      <p style={{ color: "var(--muted)", fontSize: 12, margin: "0 0 12px" }}>
        {empty}
      </p>
    );
  }

  return (
    <ul
      style={{
        listStyle: "none",
        margin: "0 0 12px",
        padding: 0,
      }}
    >
      {items.map((item) => {
        const isSelected = item.id === selectedItemId;

        return (
          <li key={item.id} style={{ marginBottom: 4 }}>
            <button
              onClick={() => onItemClick?.(item)}
              style={{
                background: isSelected ? "var(--swimlane-even)" : "transparent",
                border: `1px solid ${isSelected ? "var(--node-component-border)" : "var(--border)"}`,
                borderRadius: 6,
                color: "var(--text)",
                cursor: onItemClick ? "pointer" : "default",
                fontSize: 13,
                lineHeight: 1.45,
                padding: "6px 8px",
                textAlign: "left",
                width: "100%",
              }}
              type="button"
            >
              <div style={{ fontWeight: 600 }}>{item.label}</div>
              {item.subtitle ? (
                <div style={{ color: "var(--muted)", fontSize: 11 }}>
                  {item.subtitle}
                </div>
              ) : null}
              {item.line ? (
                <div style={{ color: "var(--muted)", fontSize: 10 }}>
                  L{item.line}
                </div>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

const tabStyle = (active: boolean) => ({
  background: active ? "var(--swimlane-even)" : "transparent",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: active ? "var(--text)" : "var(--muted)",
  cursor: "pointer",
  flex: 1,
  fontSize: 11,
  fontWeight: active ? 600 : 500,
  padding: "6px 4px",
});

function filterItems(
  items: InspectorItem[],
  kinds: InspectorItem["kind"][]
): InspectorItem[] {
  return items.filter((item) => kinds.includes(item.kind));
}

export function ComponentInspector({
  node,
  onHighlightLine,
  onItemClick,
  onSelectChild,
  scope,
  selectedItemId,
}: ComponentInspectorProps) {
  const [tab, setTab] = useState<InspectorTab>("props");

  const items = useMemo(
    () => node?.metadata?.inspectorItems ?? [],
    [node?.metadata?.inspectorItems]
  );

  const declaredProps = useMemo(
    () => filterItems(items, ["declared_prop"]),
    [items]
  );
  const receivedProps = useMemo(
    () => filterItems(items, ["received_prop"]),
    [items]
  );
  const propOrigins = useMemo(
    () => filterItems(items, ["prop_origin"]),
    [items]
  );
  const passedProps = useMemo(
    () => filterItems(items, ["passed_prop"]),
    [items]
  );
  const parents = useMemo(() => filterItems(items, ["parent"]), [items]);
  const variables = useMemo(() => filterItems(items, ["variable"]), [items]);
  const hooks = useMemo(() => filterItems(items, ["hook"]), [items]);
  const calls = useMemo(() => filterItems(items, ["call"]), [items]);

  if (!node) {
    return (
      <div style={{ color: "var(--muted)", fontSize: 13 }}>
        Select a component to inspect props, data flow, and children.
      </div>
    );
  }

  const meta = node.metadata;
  const children = meta?.children ?? [];

  const handleItemClick = (item: InspectorItem) => {
    if (item.targetNodeId && item.kind === "parent") {
      onSelectChild?.(item.targetNodeId);
      return;
    }

    if (item.line) {
      onHighlightLine?.(item.line);
    }

    onItemClick?.(item);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div>
        <h3 style={{ margin: "0 0 4px" }}>{node.label}</h3>
        <div style={{ color: "var(--muted)", fontSize: 12, lineHeight: 1.5 }}>
          <div>{node.type}</div>
          <div>Scope: {scope}</div>
          {node.filePath ? <div>{node.filePath}</div> : null}
          {node.startLine && node.endLine ? (
            <div>
              Lines {node.startLine}–{node.endLine}
            </div>
          ) : null}
        </div>
      </div>

      <div style={{ display: "flex", gap: 4, margin: "12px 0" }}>
        <button
          onClick={() => setTab("props")}
          style={tabStyle(tab === "props")}
          type="button"
        >
          Props
        </button>
        <button
          onClick={() => setTab("data")}
          style={tabStyle(tab === "data")}
          type="button"
        >
          Data
        </button>
        <button
          onClick={() => setTab("hooks")}
          style={tabStyle(tab === "hooks")}
          type="button"
        >
          Hooks
        </button>
        <button
          onClick={() => setTab("children")}
          style={tabStyle(tab === "children")}
          type="button"
        >
          Children
        </button>
      </div>

      <div style={{ flex: 1, overflow: "auto" }}>
        {tab === "props" ? (
          <div>
            <h4
              style={{ color: "var(--muted)", fontSize: 11, margin: "0 0 6px" }}
            >
              Declared props
            </h4>
            <ClickableList
              empty="No declared props in destructuring."
              items={declaredProps}
              onItemClick={handleItemClick}
              selectedItemId={selectedItemId}
            />

            <h4
              style={{ color: "var(--muted)", fontSize: 11, margin: "0 0 6px" }}
            >
              Props received
            </h4>
            <ClickableList
              empty="No props received from parent."
              items={receivedProps}
              onItemClick={handleItemClick}
              selectedItemId={selectedItemId}
            />

            <h4
              style={{ color: "var(--muted)", fontSize: 11, margin: "0 0 6px" }}
            >
              Prop origins (data → prop)
            </h4>
            <ClickableList
              empty="No prop source flow indexed."
              items={propOrigins}
              onItemClick={handleItemClick}
              selectedItemId={selectedItemId}
            />

            <h4
              style={{ color: "var(--muted)", fontSize: 11, margin: "0 0 6px" }}
            >
              Passed to children
            </h4>
            <ClickableList
              empty="No props passed to child components."
              items={passedProps}
              onItemClick={handleItemClick}
              selectedItemId={selectedItemId}
            />

            <h4
              style={{ color: "var(--muted)", fontSize: 11, margin: "0 0 6px" }}
            >
              Used by (parent)
            </h4>
            <ClickableList
              empty="No parent component in graph."
              items={parents}
              onItemClick={handleItemClick}
              selectedItemId={selectedItemId}
            />
          </div>
        ) : null}

        {tab === "data" ? (
          <div>
            <h4
              style={{ color: "var(--muted)", fontSize: 11, margin: "0 0 6px" }}
            >
              Variables
            </h4>
            <ClickableList
              empty="No variables indexed for this component."
              items={variables}
              onItemClick={handleItemClick}
              selectedItemId={selectedItemId}
            />

            <h4
              style={{ color: "var(--muted)", fontSize: 11, margin: "0 0 6px" }}
            >
              Calls
            </h4>
            <ClickableList
              empty="No calls indexed."
              items={calls}
              onItemClick={handleItemClick}
              selectedItemId={selectedItemId}
            />

            <ExecutionTimeline
              filePath={node.filePath}
              onStepClick={(line) => {
                onHighlightLine?.(line);
                const step = meta?.executionSteps?.find((s) => s.line === line);
                if (step) {
                  onItemClick?.({
                    endLine: node.endLine,
                    filePath: node.filePath,
                    focus: step.label,
                    focusKind:
                      step.kind === "hook"
                        ? "hook"
                        : step.kind === "call"
                          ? "call"
                          : "execution",
                    id: `exec:${step.order}`,
                    kind: "execution",
                    label: step.label,
                    line: step.line,
                    startLine: node.startLine,
                    subtitle: step.expression,
                  });
                }
              }}
              steps={meta?.executionSteps}
            />
          </div>
        ) : null}

        {tab === "hooks" ? (
          <div>
            <ClickableList
              empty="No hooks used in this component."
              items={hooks}
              onItemClick={handleItemClick}
              selectedItemId={selectedItemId}
            />
          </div>
        ) : null}

        {tab === "children" ? (
          <div>
            {children.length === 0 ? (
              <p style={{ color: "var(--muted)", fontSize: 12, margin: 0 }}>
                No child components rendered.
              </p>
            ) : (
              <ul
                style={{
                  listStyle: "none",
                  margin: 0,
                  padding: 0,
                }}
              >
                {children.map((child) => (
                  <li key={child.id} style={{ marginBottom: 8 }}>
                    <button
                      onClick={() => onSelectChild?.(child.id)}
                      style={{
                        background: "var(--swimlane-even)",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        color: "var(--text)",
                        cursor: "pointer",
                        padding: "8px 10px",
                        textAlign: "left",
                        width: "100%",
                      }}
                      type="button"
                    >
                      <div style={{ fontSize: 13, fontWeight: 600 }}>
                        {child.label}
                      </div>
                      <div style={{ color: "var(--muted)", fontSize: 11 }}>
                        {child.edgeType.replaceAll("_", " ")}
                        {child.props ? ` · ${child.props}` : ""}
                      </div>
                      {child.filePath ? (
                        <div
                          style={{
                            color: "var(--muted)",
                            fontSize: 10,
                            marginTop: 2,
                          }}
                        >
                          {child.filePath}
                        </div>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
