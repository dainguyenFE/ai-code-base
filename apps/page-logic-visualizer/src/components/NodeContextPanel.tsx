"use client";

import type {
  LogicGraphNode,
  PageLogicGraph,
} from "@cs/page-logic-visualizer/client";
import {
  buildNodeContext,
  isNodeExpandable,
  resolveExpressionToNode,
  traceIdentifier,
} from "@cs/page-logic-visualizer/client";

const actionButtonClass =
  "inline-flex w-full items-center justify-center rounded-md border px-3 py-2 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50";
const outlineButtonClass = `${actionButtonClass} border-border bg-background hover:bg-muted`;
const ghostButtonClass = `${actionButtonClass} border-transparent bg-transparent hover:bg-muted`;

const ClickableChip = ({
  label,
  sublabel,
  onClick,
}: {
  label: string;
  sublabel?: string;
  onClick: () => void;
}) => (
  <button
    className="flex w-full items-start justify-between gap-2 rounded-md border bg-background px-3 py-2 text-start text-xs hover:bg-accent/60"
    onClick={onClick}
    type="button"
  >
    <span>
      <span className="font-medium">{label}</span>
      {sublabel ? (
        <span className="mt-0.5 block font-mono text-muted-foreground">
          {sublabel}
        </span>
      ) : null}
    </span>
    <span className="shrink-0 text-muted-foreground">↩ trace</span>
  </button>
);

interface NodeContextPanelProps {
  graph: PageLogicGraph;
  focusNodeId: string | null;
  expandingNodeId: string | null;
  onFocusNode: (nodeId: string) => void;
  onExpandNode: (node: LogicGraphNode) => void;
  onCollapseExpansion: (nodeId: string) => void;
}

export function NodeContextPanel({
  graph,
  focusNodeId,
  expandingNodeId,
  onFocusNode,
  onExpandNode,
  onCollapseExpansion,
}: NodeContextPanelProps) {
  if (!focusNodeId) {
    return (
      <div className="rounded-lg border p-4 text-sm text-muted-foreground">
        Select a node to see visibility rules, props, and render output.
      </div>
    );
  }

  const context = buildNodeContext(graph, focusNodeId);
  const node = context?.node;

  if (!context || !node) {
    return (
      <div className="rounded-lg border p-4 text-sm text-muted-foreground">
        Node not found.
      </div>
    );
  }

  const isExpanded = node.metadata?.expanded === true;
  const canExpand = isNodeExpandable(node);

  const traceExpression = (expression: string) => {
    const resolved = resolveExpressionToNode(graph, expression, focusNodeId);
    if (resolved) {
      onFocusNode(resolved.id);
      return;
    }
    const chain = traceIdentifier(graph, expression, focusNodeId);
    const last = chain.at(-1);
    if (last) {
      onFocusNode(last.nodeId);
    }
  };

  return (
    <div className="max-h-[calc(100vh-8rem)] space-y-4 overflow-y-auto rounded-lg border bg-card p-4">
      <div>
        <h2 className="text-lg font-semibold">{node.label}</h2>
        <p className="text-sm text-muted-foreground">{node.type}</p>
      </div>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-amber-700">
          1. Shows when (conditions)
        </h3>
        {context.visibilityConditions.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Always rendered (no parent condition on this branch).
          </p>
        ) : (
          <ul className="space-y-2">
            {context.visibilityConditions.map((item) => (
              <li key={item.conditionNodeId}>
                <ClickableChip
                  label={`${item.branch === "true" ? "✓" : (item.branch === "false" ? "✗" : "•")} ${item.expression}`}
                  onClick={() => onFocusNode(item.conditionNodeId)}
                  sublabel={`under ${item.parentLabel}`}
                />
                {item.inputs.length > 0 ? (
                  <div className="mt-1 flex flex-wrap gap-1 ps-1">
                    {item.inputs.map((input) => (
                      <button
                        className="rounded bg-muted px-2 py-0.5 font-mono text-[10px] hover:bg-accent"
                        key={input}
                        onClick={() => traceExpression(input)}
                        type="button"
                      >
                        {input} ← source
                      </button>
                    ))}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-emerald-700">
          2. Props / data in
        </h3>
        {context.dataSources.length > 0 ? (
          <div className="mb-2 space-y-1 rounded-md border border-emerald-500/20 bg-emerald-500/5 p-2">
            <p className="text-xs font-medium">Inbound data sources</p>
            {context.dataSources.map((source) => (
              <button
                className="flex w-full items-start justify-between gap-2 rounded bg-background px-2 py-1 text-start text-xs hover:bg-accent"
                key={`${source.kind}:${source.label}`}
                onClick={() =>
                  source.nodeId ? onFocusNode(source.nodeId) : undefined
                }
                type="button"
              >
                <span>
                  <span className="font-mono text-[10px] uppercase text-muted-foreground">
                    {source.kind}
                  </span>
                  <span className="block font-medium">{source.label}</span>
                  {source.detail ? (
                    <span className="text-muted-foreground">
                      {source.detail}
                    </span>
                  ) : null}
                </span>
              </button>
            ))}
          </div>
        ) : null}

        {context.propsIn.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No props on this node.
          </p>
        ) : (
          <ul className="space-y-2">
            {context.propsIn.map((prop) => (
              <li key={prop.name}>
                <ClickableChip
                  label={`${prop.name} ← ${prop.expression}`}
                  onClick={() => traceExpression(prop.expression)}
                  sublabel={
                    prop.sourceLabel
                      ? `${prop.sourceKind ?? "props"} · ${prop.sourceType}: ${prop.sourceLabel}`
                      : `${prop.sourceKind ?? "props"} · click to trace source`
                  }
                />
              </li>
            ))}
          </ul>
        )}

        {node.type === "hook" && node.hook ? (
          <div className="space-y-1 rounded-md border border-violet-500/30 bg-violet-500/5 p-2">
            <p className="text-xs font-medium">Hook inputs</p>
            {node.hook.inputs.map((field) => (
              <button
                className="block w-full rounded bg-background px-2 py-1 text-start text-xs hover:bg-accent"
                key={field.name}
                onClick={() =>
                  field.source ? traceExpression(field.source) : undefined
                }
                type="button"
              >
                {field.name} ← {field.source ?? "?"}
              </button>
            ))}
          </div>
        ) : null}

        {node.dataFetch ? (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2 text-xs">
            <p className="font-medium">Function output</p>
            <p className="font-mono text-muted-foreground">
              {node.dataFetch.outputNames?.join(", ") ?? "—"}
            </p>
          </div>
        ) : null}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-sky-700">3. Renders out</h3>
        {context.rendersOut.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Leaf node — expand (↳) to see internals.
          </p>
        ) : (
          <ul className="space-y-2">
            {context.rendersOut.map((child) => (
              <li key={child.nodeId}>
                <ClickableChip
                  label={child.label}
                  onClick={() => onFocusNode(child.nodeId)}
                  sublabel={`${child.edgeType}${child.edgeLabel ? ` (${child.edgeLabel})` : ""} · ${child.type}`}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {node.type === "condition" && node.condition ? (
        <section className="space-y-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
          <h3 className="text-sm font-medium">Trace condition inputs</h3>
          <div className="flex flex-wrap gap-1">
            {node.condition.inputs?.map((input) => (
              <button
                className="rounded bg-background px-2 py-1 font-mono text-xs hover:bg-accent"
                key={input}
                onClick={() => traceExpression(input)}
                type="button"
              >
                {input}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            true → {node.condition.trueOutput} · false →{" "}
            {node.condition.falseOutput}
          </p>
        </section>
      ) : null}

      {canExpand ? (
        <button
          className={outlineButtonClass}
          disabled={expandingNodeId === node.id || isExpanded}
          onClick={() => onExpandNode(node)}
          type="button"
        >
          {expandingNodeId === node.id
            ? "Expanding..."
            : (isExpanded
              ? "Already expanded"
              : "Expand internals (↳)")}
        </button>
      ) : null}

      {isExpanded ? (
        <button
          className={ghostButtonClass}
          onClick={() => onCollapseExpansion(node.id)}
          type="button"
        >
          Collapse expanded internals
        </button>
      ) : null}
    </div>
  );
}
