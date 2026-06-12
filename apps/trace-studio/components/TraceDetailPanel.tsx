import type { TraceNode } from "@/lib/types";

import { ExecutionTimeline } from "./ExecutionTimeline";

interface TraceDetailPanelProps {
  node?: TraceNode;
  scope: string;
}

function ListSection({ title, items }: { title: string; items?: string[] }) {
  if (!items?.length) {
    return null;
  }

  return (
    <section style={{ marginTop: 12 }}>
      <h4 style={{ color: "var(--muted)", fontSize: 11, margin: "0 0 6px" }}>
        {title}
      </h4>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {items.map((item, index) => (
          <li key={`${title}-${index}`} style={{ fontSize: 13 }}>
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function TraceDetailPanel({ node, scope }: TraceDetailPanelProps) {
  if (!node) {
    return (
      <div style={{ color: "var(--muted)", fontSize: 13 }}>
        Select a node to see metadata.
      </div>
    );
  }

  return (
    <div style={{ fontSize: 13 }}>
      <h3 style={{ margin: "0 0 8px" }}>{node.label}</h3>
      <div style={{ color: "var(--muted)", lineHeight: 1.6 }}>
        <div>Type: {node.type}</div>
        <div>Scope: {scope}</div>
        {node.filePath ? <div>File: {node.filePath}</div> : null}
        {node.startLine && node.endLine ? (
          <div>
            Lines: {node.startLine}-{node.endLine}
          </div>
        ) : null}
      </div>

      <ExecutionTimeline
        filePath={node.filePath}
        steps={node.metadata?.executionSteps}
      />

      <ListSection items={node.metadata?.props} title="Declared props" />
      <ListSection
        items={node.metadata?.propsReceived}
        title="Props received"
      />
      <ListSection items={node.metadata?.propOrigins} title="Prop origins" />
      <ListSection items={node.metadata?.callChain} title="Call chain" />
      <ListSection items={node.metadata?.renders} title="Renders" />
      <ListSection items={node.metadata?.usesHooks} title="Hooks" />
      <ListSection items={node.metadata?.calls} title="Calls" />
      <ListSection items={node.metadata?.usedBy} title="Used by" />
    </div>
  );
}
