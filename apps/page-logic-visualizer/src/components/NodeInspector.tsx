"use client";

import type {
  LogicGraphNode,
  PageLogicGraph,
} from "@cs/page-logic-visualizer/client";
import {
  getDownstreamNodes,
  getUpstreamNodes,
  isNodeExpandable,
} from "@cs/page-logic-visualizer/client";

const actionButtonClass =
  "inline-flex w-full items-center justify-center rounded-md border px-3 py-2 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50";
const outlineButtonClass = `${actionButtonClass} border-border bg-background hover:bg-muted`;
const ghostButtonClass = `${actionButtonClass} border-transparent bg-transparent hover:bg-muted`;

interface NodeInspectorProps {
  graph: PageLogicGraph;
  selectedNodeId: string | null;
  expandingNodeId: string | null;
  onExpandNode: (node: LogicGraphNode) => void;
  onCollapseExpansion: (nodeId: string) => void;
}

const DetailRow = ({
  label,
  value,
}: {
  label: string;
  value?: string | null;
}) => {
  if (!value) {
    return null;
  }
  return (
    <div className="grid grid-cols-[110px_1fr] gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <code className="break-all rounded bg-muted px-1 py-0.5 text-xs">
        {value}
      </code>
    </div>
  );
};

export function NodeInspector({
  graph,
  selectedNodeId,
  expandingNodeId,
  onExpandNode,
  onCollapseExpansion,
}: NodeInspectorProps) {
  const node: LogicGraphNode | undefined = graph.nodes.find(
    (item) => item.id === selectedNodeId
  );

  const childEdges = graph.edges.filter(
    (edge) => edge.source === selectedNodeId
  );

  const parentEdges = graph.edges.filter(
    (edge) => edge.target === selectedNodeId
  );

  const upstream = selectedNodeId
    ? getUpstreamNodes(graph, selectedNodeId)
    : [];
  const downstream = selectedNodeId
    ? getDownstreamNodes(graph, selectedNodeId)
    : [];

  if (!node) {
    return (
      <div className="rounded-lg border p-4 text-sm text-muted-foreground">
        Select a node to inspect render logic, inputs, and outputs.
      </div>
    );
  }

  const isExpanded = node.metadata?.expanded === true;
  const canExpand = isNodeExpandable(node);

  return (
    <div className="space-y-4 rounded-lg border bg-card p-4">
      <div>
        <h2 className="text-lg font-semibold">{node.label}</h2>
        <p className="text-sm text-muted-foreground">{node.type}</p>
      </div>

      <DetailRow label="File" value={node.filePath} />
      <DetailRow label="Import" value={node.importPath} />
      <DetailRow label="Package" value={node.packageName} />

      {node.type === "condition" && node.condition ? (
        <div className="space-y-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
          <h3 className="text-sm font-medium text-amber-700">Render logic</h3>
          <DetailRow label="Expression" value={node.condition.expression} />
          <DetailRow label="Inputs" value={node.condition.inputs?.join(", ")} />
          <DetailRow label="If true" value={node.condition.trueOutput} />
          <DetailRow label="If false" value={node.condition.falseOutput} />
          <p className="text-xs text-muted-foreground">
            This branch decides which UI subtree renders under the parent node.
          </p>
        </div>
      ) : null}

      {node.loop ? (
        <div className="space-y-2 rounded-md border border-orange-500/30 bg-orange-500/5 p-3">
          <h3 className="text-sm font-medium text-orange-700">Loop render</h3>
          <DetailRow label="Source" value={node.loop.sourceExpression} />
          <DetailRow label="Item" value={node.loop.itemName ?? "item"} />
          <DetailRow
            label="Output"
            value={`Repeats child for each item in ${node.loop.sourceExpression}`}
          />
        </div>
      ) : null}

      {node.dataFetch ? (
        <div className="space-y-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3">
          <h3 className="text-sm font-medium text-emerald-700">Data input</h3>
          <DetailRow
            label="Call"
            value={`await ${node.dataFetch.callExpression}`}
          />
          <DetailRow label="Function" value={node.dataFetch.functionName} />
          <DetailRow label="Import" value={node.dataFetch.importPath} />
          <DetailRow
            label="Output"
            value={node.dataFetch.outputNames?.join(", ")}
          />
          <p className="text-xs text-muted-foreground">
            Output feeds variables used by render conditions and props below.
          </p>
        </div>
      ) : null}

      {node.hook ? (
        <div className="space-y-2 rounded-md border border-violet-500/30 bg-violet-500/5 p-3">
          <h3 className="text-sm font-medium text-violet-700">Hook logic</h3>
          <DetailRow label="Call" value={node.hook.callExpression} />
          <DetailRow label="Import" value={node.hook.importPath} />
          {node.hook.nestedHooks && node.hook.nestedHooks.length > 0 ? (
            <DetailRow
              label="Nested hooks"
              value={node.hook.nestedHooks.join(", ")}
            />
          ) : null}
          {node.hook.inputs.length > 0 ? (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">
                Inputs (data from)
              </p>
              <ul className="space-y-1 text-xs">
                {node.hook.inputs.map((field) => (
                  <li className="rounded bg-muted px-2 py-1" key={field.name}>
                    <span className="font-medium">{field.name}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      ← {field.source ?? "unknown"} ({field.kind})
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {node.hook.outputs.length > 0 ? (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">
                Outputs (used in)
              </p>
              <ul className="space-y-1 text-xs">
                {node.hook.outputs.map((field) => (
                  <li className="rounded bg-muted px-2 py-1" key={field.name}>
                    <span className="font-medium">{field.name}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      ({field.kind}){field.source ? ` = ${field.source}` : ""}
                      {field.usedIn?.length
                        ? ` → ${field.usedIn.join(", ")}`
                        : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {node.uiContent ? (
        <div className="space-y-2 rounded-md border border-sky-500/30 bg-sky-500/5 p-3">
          <h3 className="text-sm font-medium text-sky-700">UI content</h3>
          <DetailRow label="Kind" value={node.uiContent.contentKind} />
          <DetailRow label="Preview" value={node.uiContent.preview} />
          <DetailRow label="Binds to" value={node.uiContent.bindsTo} />
        </div>
      ) : null}

      {node.props && node.props.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Props (data passed in)</h3>
          <ul className="space-y-1 text-xs">
            {node.props.map((prop) => (
              <li className="rounded bg-muted px-2 py-1" key={prop.name}>
                <span className="font-medium">{prop.name}</span>
                <span className="text-muted-foreground"> ← </span>
                <code>{prop.expression}</code>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {upstream.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Data / logic upstream</h3>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {upstream.map((item) => (
              <li key={item.id}>
                {item.type}: {item.label}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {downstream.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Feeds into</h3>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {downstream.map((item) => (
              <li key={item.id}>
                {item.type}: {item.label}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {parentEdges.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Comes from</h3>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {parentEdges.map((edge) => {
              const parent = graph.nodes.find(
                (item) => item.id === edge.source
              );
              return (
                <li key={edge.id}>
                  {parent?.label ?? edge.source} via {edge.type}
                  {edge.label ? ` (${edge.label})` : ""}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {childEdges.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Renders</h3>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {childEdges.map((edge) => {
              const child = graph.nodes.find((item) => item.id === edge.target);
              return (
                <li key={edge.id}>
                  {edge.type}
                  {edge.label ? ` (${edge.label})` : ""}:{" "}
                  {child?.label ?? edge.target}
                </li>
              );
            })}
          </ul>
        </div>
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
              ? "Component expanded"
              : "Expand component internals")}
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
