"use client";

import {
  buildUiTree,
  findUiTreeNode,
  findUiTreeNodePath,
  flattenUiTree,
  hookCallNameFromGraphNode,
  isNodeExpandable,
} from "@cs/page-logic-visualizer/client";
import type {
  DataTraceChain,
  HookTraceView,
  LogicGraphNode,
  PageLogicGraph,
  UiLocalItem,
  UiLocalsMeta,
  UiTreeNode,
} from "@cs/page-logic-visualizer/client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { MouseEventHandler } from "react";

import {
  HTML_BADGE_STYLES,
  resolveHtmlNodeDisplay,
} from "@/lib/htmlNodeDisplay";
import type { LocalItemTone, TraceStepFocusMeta } from "@/lib/sourceView";

interface UiGraphViewerProps {
  graph: PageLogicGraph;
  /** When set, the render tree focuses this component instead of graph root */
  focusRootId?: string;
  selectedNodeId: string | null;
  search: string;
  expandingNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  onOpenSourceNode: (nodeId: string, traceMeta?: TraceStepFocusMeta) => void;
  onOpenSourceLocal: (
    consumerNodeId: string,
    item: UiLocalItem,
    tone: LocalItemTone
  ) => void;
  onExpandNode: (node: LogicGraphNode) => void | Promise<void>;
  activeTrace: DataTraceChain | null;
  onTraceData: (
    expression: string,
    consumerNodeId: string,
    options?: { propName?: string; variableName?: string }
  ) => void;
  onTraceHook: (
    request: HookTraceRequest
  ) => void | Promise<void> | Promise<HookTraceView | undefined>;
  onFocusRootChange?: (nodeId: string) => void;
}

export type HookTraceRequest =
  | {
      consumerNodeId: string;
      effectHookName: string;
      mode: "effect";
    }
  | {
      consumerNodeId: string;
      fieldName?: string;
      mode: "local";
      sourceHook: string;
    }
  | {
      hookNodeId: string;
      consumerNodeId?: string;
      mode: "hook";
    };

const openSourceOnDoubleClick =
  (handler: () => void): MouseEventHandler =>
  (event) => {
    event.preventDefault();
    event.stopPropagation();
    handler();
  };

const TYPE_BADGE: Record<string, string> = {
  component: "bg-blue-500/15 text-blue-700",
  html: "bg-teal-500/15 text-teal-800",
  layout: "bg-slate-500/15 text-slate-700",
  page: "bg-foreground/10 text-foreground",
  route: "bg-slate-500/15 text-slate-600",
};

const isHtmlUiNode = (node: LogicGraphNode): boolean =>
  node.metadata?.isHtml === true;

const nodeTypeBadge = (node: LogicGraphNode): string =>
  isHtmlUiNode(node) ? "html" : node.type;

type HtmlChildViewMode = "elements" | "components";

const childrenSectionLabel = (
  children: UiTreeNode[],
  mode: HtmlChildViewMode
): string => {
  if (mode === "components") {
    return "Components";
  }
  return children.some((child) => isHtmlUiNode(child.node))
    ? "Elements"
    : "Components";
};

const htmlTextContent = (node: LogicGraphNode): string | undefined => {
  const value = node.metadata?.htmlTextContent;
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

const HtmlDisplayBadges = ({
  node,
  hasChildren,
}: {
  node: LogicGraphNode;
  hasChildren: boolean;
}) => {
  const { badges } = resolveHtmlNodeDisplay(node, { hasChildren });
  if (badges.length === 0) {
    return null;
  }
  return (
    <>
      {badges.map((badge) => (
        <span
          className={[
            "rounded px-1 py-0.5 font-mono text-[8px] uppercase",
            HTML_BADGE_STYLES[badge.tone],
          ].join(" ")}
          key={`${badge.tone}:${badge.label}`}
        >
          {badge.label}
        </span>
      ))}
    </>
  );
};

/** Under an HTML parent: show DOM children or flatten to components only. */
const filterChildrenForHtmlMode = (
  children: UiTreeNode[],
  parent: UiTreeNode,
  modes: Map<string, HtmlChildViewMode>
): UiTreeNode[] => {
  if (!isHtmlUiNode(parent.node)) {
    return children;
  }
  const mode = modes.get(parent.nodeId) ?? "elements";
  if (mode === "elements") {
    return children;
  }
  const flattened: UiTreeNode[] = [];
  for (const child of children) {
    if (isHtmlUiNode(child.node)) {
      flattened.push(
        ...filterChildrenForHtmlMode(child.children, child, modes)
      );
    } else {
      flattened.push(child);
    }
  }
  return flattened;
};

const localsCount = (locals: UiLocalsMeta): number =>
  locals.props.length +
  locals.variables.length +
  locals.functions.length +
  locals.hooks.length;

const matchesSearch = (node: UiTreeNode, search: string): boolean => {
  if (!search) {
    return true;
  }
  const { locals } = node;
  const haystack = [
    node.node.label,
    node.node.filePath,
    htmlTextContent(node.node) ?? "",
    ...(node.node.props?.map((prop) => `${prop.name} ${prop.expression}`) ??
      []),
    ...node.children.map((child) => child.node.label),
    ...locals.props.map((item) => item.name),
    ...locals.variables.map((item) => item.name),
    ...locals.functions.map((item) => item.name),
    ...locals.hooks.map((item) => item.name),
    ...node.dataUsed.map((item) => item.label),
    ...node.localConditions.map((item) => item.expression),
    ...node.gateConditions.map((item) => item.expression),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(search.toLowerCase());
};

const subtreeMatchesSearch = (node: UiTreeNode, search: string): boolean => {
  if (matchesSearch(node, search)) {
    return true;
  }
  return node.children.some((child) => subtreeMatchesSearch(child, search));
};

const cardHighlightClass = (
  nodeId: string,
  selectedNodeId: string | null,
  activeTrace: DataTraceChain | null
): string => {
  const isSelected = selectedNodeId === nodeId;
  const isOnTracePath = activeTrace?.highlightedUiNodeIds.includes(nodeId);
  const isConsumer = activeTrace?.consumerNodeId === nodeId;
  if (isSelected) {
    return "border-primary ring-2 ring-primary/25";
  }
  if (isOnTracePath || isConsumer) {
    return "border-amber-500/60 ring-2 ring-amber-400/30";
  }
  return "border-border";
};

const LOCAL_CHIP_STYLES = {
  functions: "border-cyan-500/40 bg-cyan-500/10 text-cyan-800",
  hooks: "border-violet-500/40 bg-violet-500/10 text-violet-800",
  props: "border-slate-500/40 bg-slate-500/10 text-slate-700",
  variables: "border-emerald-500/40 bg-emerald-500/10 text-emerald-800",
} as const;

const LocalChip = ({
  item,
  isHighlighted,
  onClick,
  onOpenSource,
  tone,
}: {
  item: UiLocalItem;
  isHighlighted: boolean;
  onClick?: () => void;
  onOpenSource: () => void;
  tone: keyof typeof LOCAL_CHIP_STYLES;
}) => {
  const className = [
    "inline-flex max-w-full items-center rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all",
    LOCAL_CHIP_STYLES[tone],
    isHighlighted ? "ring-2 ring-primary shadow-sm" : "hover:brightness-95",
    "cursor-pointer",
  ].join(" ");

  return (
    <button
      className={className}
      onClick={onClick}
      onDoubleClick={openSourceOnDoubleClick(onOpenSource)}
      title={`${item.expression ?? item.name} · double-click for source`}
      type="button"
    >
      <span className="truncate">{item.name}</span>
    </button>
  );
};

const traceExpressionForLocal = (
  item: UiLocalItem,
  tone: LocalItemTone
): string => (tone === "props" ? (item.expression ?? item.name) : item.name);

const LocalsSection = ({
  activeTrace,
  compact,
  consumerNodeId,
  items,
  onOpenDataTrace,
  onOpenSourceLocal,
  onTraceHook,
  title,
  tone,
}: {
  activeTrace: DataTraceChain | null;
  compact?: boolean;
  consumerNodeId: string;
  items: UiLocalItem[];
  onOpenDataTrace: (
    expression: string,
    consumerNodeId: string,
    options?: { propName?: string; variableName?: string }
  ) => void;
  onOpenSourceLocal: (
    consumerNodeId: string,
    item: UiLocalItem,
    tone: LocalItemTone
  ) => void;
  onTraceHook: (
    request: HookTraceRequest
  ) => void | Promise<void> | Promise<HookTraceView | undefined>;
  title: string;
  tone: LocalItemTone;
}) => {
  if (items.length === 0) {
    return null;
  }

  const handleChipClick = (item: UiLocalItem) => {
    const traceExpression = traceExpressionForLocal(item, tone);
    onOpenDataTrace(traceExpression, consumerNodeId, {
      propName: tone === "props" ? item.name : undefined,
      variableName: tone === "variables" ? item.name : undefined,
    });
  };

  return (
    <section
      className={compact ? "space-y-1" : "border-b px-3 py-2.5 last:border-b-0"}
    >
      <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h4>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => {
          const traceExpression = traceExpressionForLocal(item, tone);
          return (
            <LocalChip
              isHighlighted={
                Boolean(
                  item.nodeId &&
                  activeTrace?.steps.some((step) => step.nodeId === item.nodeId)
                ) ||
                activeTrace?.expression === traceExpression ||
                activeTrace?.expression === item.name
              }
              item={item}
              key={item.name}
              onClick={() => handleChipClick(item)}
              onOpenSource={() => onOpenSourceLocal(consumerNodeId, item, tone)}
              tone={tone}
            />
          );
        })}
      </div>
    </section>
  );
};

const GateChip = ({
  expression,
  branch,
  conditionNodeId,
  loc,
  onOpenSource,
}: {
  expression: string;
  branch: "true" | "false";
  conditionNodeId: string;
  loc?: UiTreeNode["gateConditions"][number]["loc"];
  onOpenSource: (nodeId: string, traceMeta?: TraceStepFocusMeta) => void;
}) => (
  <button
    className="inline-flex max-w-full items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[10px] text-amber-800 hover:bg-amber-500/15"
    onClick={() =>
      onOpenSource(conditionNodeId, {
        label: expression,
        loc,
      })
    }
    title={`${expression} · click for source`}
    type="button"
  >
    <span className="font-mono">{branch === "true" ? "✓" : "✗"}</span>
    <span className="truncate">{expression}</span>
  </button>
);

const ComponentHooksSection = ({
  activeTrace,
  compact,
  consumerNodeId,
  effectHooks,
  graph,
  onTraceHook,
}: {
  activeTrace: DataTraceChain | null;
  compact?: boolean;
  consumerNodeId: string;
  effectHooks: UiLocalItem[];
  graph: PageLogicGraph;
  onTraceHook: (
    request: HookTraceRequest
  ) => void | Promise<void> | Promise<HookTraceView | undefined>;
}) => {
  const dataHooks = useMemo(
    () =>
      graph.edges
        .filter(
          (edge) => edge.source === consumerNodeId && edge.type === "uses-hook"
        )
        .map((edge) => graph.nodes.find((node) => node.id === edge.target))
        .filter(
          (
            node
          ): node is LogicGraphNode &
            ({ type: "hook" } | { type: "store" } | { type: "context" }) =>
            node?.type === "hook" ||
            node?.type === "store" ||
            node?.type === "context"
        )
        .map((node) => ({
          hookNodeId: node.id,
          label: hookCallNameFromGraphNode(node) ?? node.label,
        })),
    [consumerNodeId, graph]
  );

  if (dataHooks.length === 0 && effectHooks.length === 0) {
    return null;
  }

  return (
    <section
      className={compact ? "space-y-1" : "border-b px-3 py-2.5 last:border-b-0"}
    >
      <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        3. Hooks
      </h4>
      <div className="flex flex-wrap gap-1.5">
        {dataHooks.map((hook) => (
          <button
            className={[
              "inline-flex max-w-full items-center rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all",
              LOCAL_CHIP_STYLES.hooks,
              activeTrace?.steps.some((step) => step.nodeId === hook.hookNodeId)
                ? "ring-2 ring-primary shadow-sm"
                : "hover:brightness-95",
            ].join(" ")}
            key={hook.hookNodeId}
            onClick={() =>
              void onTraceHook({
                consumerNodeId,
                hookNodeId: hook.hookNodeId,
                mode: "hook",
              })
            }
            type="button"
            title={`Trace ${hook.label}() implementation`}
          >
            {hook.label}()
          </button>
        ))}
        {effectHooks.map((item) => (
          <button
            className={[
              "inline-flex max-w-full items-center rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all",
              LOCAL_CHIP_STYLES.hooks,
              activeTrace?.expression === item.name
                ? "ring-2 ring-primary shadow-sm"
                : "hover:brightness-95",
            ].join(" ")}
            key={item.name}
            onClick={() =>
              void onTraceHook({
                consumerNodeId,
                effectHookName: item.name,
                mode: "effect",
              })
            }
            type="button"
            title={`Trace ${item.name}() lifecycle`}
          >
            {item.name}()
          </button>
        ))}
      </div>
    </section>
  );
};

const CardBody = ({
  treeNode,
  activeTrace,
  compact,
  graph,
  showGateConditions,
  onOpenDataTrace,
  onOpenSourceLocal,
  onOpenSourceNode,
  onTraceHook,
}: {
  treeNode: UiTreeNode;
  activeTrace: DataTraceChain | null;
  compact?: boolean;
  graph: PageLogicGraph;
  /** Parent always renders — only children show gate chips when gated. */
  showGateConditions: boolean;
  onOpenDataTrace: (
    expression: string,
    consumerNodeId: string,
    options?: { propName?: string; variableName?: string }
  ) => void;
  onOpenSourceLocal: (
    consumerNodeId: string,
    item: UiLocalItem,
    tone: LocalItemTone
  ) => void;
  onOpenSourceNode: (nodeId: string, traceMeta?: TraceStepFocusMeta) => void;
  onTraceHook: (
    request: HookTraceRequest
  ) => void | Promise<void> | Promise<HookTraceView | undefined>;
}) => {
  const gateConditions = showGateConditions ? treeNode.gateConditions : [];
  const { locals } = treeNode;
  const variableItems = useMemo(
    () => [...locals.variables, ...locals.functions],
    [locals.functions, locals.variables]
  );
  const hasDataHooks = graph.edges.some(
    (edge) => edge.source === treeNode.nodeId && edge.type === "uses-hook"
  );
  if (isHtmlUiNode(treeNode.node)) {
    return null;
  }

  const hasLocals =
    locals.props.length > 0 ||
    variableItems.length > 0 ||
    locals.hooks.length > 0 ||
    hasDataHooks;
  const hasBody = hasLocals || gateConditions.length > 0;

  if (!hasBody) {
    return null;
  }

  return (
    <div className={compact ? "space-y-2 pt-2" : "space-y-0"}>
      <LocalsSection
        activeTrace={activeTrace}
        compact={compact}
        consumerNodeId={treeNode.nodeId}
        items={locals.props}
        onOpenDataTrace={onOpenDataTrace}
        onOpenSourceLocal={onOpenSourceLocal}
        onTraceHook={onTraceHook}
        title="1. Props"
        tone="props"
      />
      <LocalsSection
        activeTrace={activeTrace}
        compact={compact}
        consumerNodeId={treeNode.nodeId}
        items={variableItems}
        onOpenDataTrace={onOpenDataTrace}
        onOpenSourceLocal={onOpenSourceLocal}
        onTraceHook={onTraceHook}
        title="2. Variables"
        tone="variables"
      />
      <ComponentHooksSection
        activeTrace={activeTrace}
        compact={compact}
        consumerNodeId={treeNode.nodeId}
        effectHooks={locals.hooks}
        graph={graph}
        onTraceHook={onTraceHook}
      />

      {gateConditions.length > 0 ? (
        <section
          className={compact ? "space-y-1" : "bg-amber-500/5 px-3 py-2.5"}
        >
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">
              gated
            </span>
            <div className="flex flex-wrap gap-1.5">
              {gateConditions.map((cond) => (
                <GateChip
                  branch={cond.branch}
                  conditionNodeId={cond.conditionNodeId}
                  expression={cond.expression}
                  key={`${cond.conditionNodeId}:${cond.branch}`}
                  loc={cond.loc}
                  onOpenSource={onOpenSourceNode}
                />
              ))}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
};

const ChildCardsGrid = ({
  children,
  parentTreeNode,
  htmlChildModes,
  expandedChildIds,
  focusRootId,
  graph,
  onToggleChild,
  search,
  selectedNodeId,
  expandingNodeId,
  activeTrace,
  onSelectNode,
  onOpenSourceNode,
  onOpenSourceLocal,
  onExpandNode,
  onOpenDataTrace,
  onFocusComponent,
  onTraceHook,
  onToggleHtmlChildMode,
}: {
  children: UiTreeNode[];
  parentTreeNode: UiTreeNode;
  htmlChildModes: Map<string, HtmlChildViewMode>;
  expandedChildIds: Set<string>;
  focusRootId: string;
  graph: PageLogicGraph;
  onToggleChild: (nodeId: string) => void;
  onToggleHtmlChildMode: (nodeId: string) => void;
  search: string;
  selectedNodeId: string | null;
  expandingNodeId: string | null;
  activeTrace: DataTraceChain | null;
  onSelectNode: (nodeId: string) => void;
  onOpenSourceNode: (nodeId: string) => void;
  onOpenSourceLocal: (
    consumerNodeId: string,
    item: UiLocalItem,
    tone: LocalItemTone
  ) => void;
  onExpandNode: (node: LogicGraphNode) => void | Promise<void>;
  onOpenDataTrace: (
    expression: string,
    consumerNodeId: string,
    options?: { propName?: string; variableName?: string }
  ) => void;
  onFocusComponent: (node: LogicGraphNode) => void | Promise<void>;
  onTraceHook: (
    request: HookTraceRequest
  ) => void | Promise<void> | Promise<HookTraceView | undefined>;
}) => {
  const childViewMode = isHtmlUiNode(parentTreeNode.node)
    ? (htmlChildModes.get(parentTreeNode.nodeId) ?? "elements")
    : "elements";
  const resolvedChildren = filterChildrenForHtmlMode(
    children,
    parentTreeNode,
    htmlChildModes
  );
  const visible = resolvedChildren.filter((child) =>
    subtreeMatchesSearch(child, search)
  );

  if (visible.length === 0) {
    return <p className="text-xs text-muted-foreground">No child components</p>;
  }

  return (
    <div className="flex w-full flex-col gap-2">
      {visible.map((child) => (
        <UiChildCard
          activeTrace={activeTrace}
          expanded={expandedChildIds.has(child.nodeId)}
          expandedChildIds={expandedChildIds}
          expandingNodeId={expandingNodeId}
          focusRootId={focusRootId}
          graph={graph}
          htmlChildModes={htmlChildModes}
          key={child.nodeId}
          onExpandNode={onExpandNode}
          onFocusComponent={onFocusComponent}
          onOpenSourceLocal={onOpenSourceLocal}
          onOpenSourceNode={onOpenSourceNode}
          onSelectNode={onSelectNode}
          onToggle={() => onToggleChild(child.nodeId)}
          onToggleChild={onToggleChild}
          onToggleHtmlChildMode={onToggleHtmlChildMode}
          onOpenDataTrace={onOpenDataTrace}
          onTraceHook={onTraceHook}
          search={search}
          selectedNodeId={selectedNodeId}
          treeNode={child}
        />
      ))}
    </div>
  );
};

const UiChildCard = ({
  treeNode,
  expanded,
  expandedChildIds,
  focusRootId,
  graph,
  htmlChildModes,
  onToggle,
  onToggleHtmlChildMode,
  search,
  selectedNodeId,
  expandingNodeId,
  activeTrace,
  onSelectNode,
  onOpenSourceNode,
  onOpenSourceLocal,
  onExpandNode,
  onToggleChild,
  onOpenDataTrace,
  onFocusComponent,
  onTraceHook,
}: {
  treeNode: UiTreeNode;
  expanded: boolean;
  expandedChildIds: Set<string>;
  focusRootId: string;
  graph: PageLogicGraph;
  htmlChildModes: Map<string, HtmlChildViewMode>;
  onToggle: () => void;
  onToggleHtmlChildMode: (nodeId: string) => void;
  search: string;
  selectedNodeId: string | null;
  expandingNodeId: string | null;
  activeTrace: DataTraceChain | null;
  onSelectNode: (nodeId: string) => void;
  onOpenSourceNode: (nodeId: string) => void;
  onOpenSourceLocal: (
    consumerNodeId: string,
    item: UiLocalItem,
    tone: LocalItemTone
  ) => void;
  onExpandNode: (node: LogicGraphNode) => void | Promise<void>;
  onToggleChild: (nodeId: string) => void;
  onOpenDataTrace: (
    expression: string,
    consumerNodeId: string,
    options?: { propName?: string; variableName?: string }
  ) => void;
  onFocusComponent: (node: LogicGraphNode) => void | Promise<void>;
  onTraceHook: (
    request: HookTraceRequest
  ) => void | Promise<void> | Promise<HookTraceView | undefined>;
}) => {
  const { node } = treeNode;
  const canAnalyze = isNodeExpandable(node) && !isHtmlUiNode(node);
  const isAnalyzed = node.metadata?.expanded === true;
  const hasGate = treeNode.gateConditions.length > 0;
  const isExpanding = expandingNodeId === node.id;
  const htmlChildMode = htmlChildModes.get(treeNode.nodeId) ?? "elements";
  const hasChildren = treeNode.children.length > 0;
  const showHtmlChildToggle = isHtmlUiNode(node) && hasChildren;
  const isHtml = isHtmlUiNode(node);
  const htmlDisplay = isHtml
    ? resolveHtmlNodeDisplay(node, { hasChildren })
    : null;

  const handleToggle = () => {
    if (!expanded && canAnalyze && !isAnalyzed && !isExpanding) {
      onExpandNode(node);
    }
    onToggle();
  };

  const handleTitleDoubleClick = () => {
    if (isHtml) {
      onOpenSourceNode(treeNode.nodeId);
      return;
    }
    if (treeNode.nodeId === focusRootId) {
      onOpenSourceNode(treeNode.nodeId);
      return;
    }
    void onFocusComponent(node);
  };

  const handleTitleClick = () => {
    onSelectNode(treeNode.nodeId);
    if (isHtml) {
      onOpenSourceNode(treeNode.nodeId);
    }
  };

  return (
    <div
      className={[
        "flex w-full flex-col overflow-hidden rounded-lg border bg-background shadow-sm transition-all",
        cardHighlightClass(treeNode.nodeId, selectedNodeId, activeTrace),
        expanded ? "ring-1 ring-border" : "",
      ].join(" ")}
    >
      <div
        className={[
          "flex items-center gap-1 px-2",
          isHtml ? "py-1" : "py-1.5",
          hasChildren ? "border-b bg-muted/20" : "bg-muted/10",
        ].join(" ")}
      >
        {hasChildren ? (
          <button
            aria-expanded={expanded}
            aria-label={expanded ? "Collapse card" : "Expand card"}
            className="flex size-6 shrink-0 items-center justify-center rounded border bg-card text-xs hover:bg-accent disabled:opacity-50"
            disabled={isExpanding}
            onClick={handleToggle}
            type="button"
          >
            {isExpanding ? "…" : (expanded ? "−" : "+")}
          </button>
        ) : null}
        {showHtmlChildToggle ? (
          <button
            aria-label={
              htmlChildMode === "elements"
                ? "Show components only"
                : "Show HTML elements"
            }
            className={[
              "flex h-6 shrink-0 items-center justify-center rounded border px-1.5 text-[9px] font-medium hover:bg-accent",
              htmlChildMode === "elements"
                ? "border-teal-500/40 bg-teal-500/10 text-teal-800"
                : "border-blue-500/40 bg-blue-500/10 text-blue-800",
            ].join(" ")}
            onClick={() => onToggleHtmlChildMode(treeNode.nodeId)}
            title={
              htmlChildMode === "elements"
                ? "Showing HTML elements — click for components only"
                : "Showing components only — click for HTML elements"
            }
            type="button"
          >
            {htmlChildMode === "elements" ? "HTML" : "Cmp"}
          </button>
        ) : null}
        <button
          className="min-w-0 flex-1 text-start"
          onClick={handleTitleClick}
          onDoubleClick={openSourceOnDoubleClick(handleTitleDoubleClick)}
          title={
            isHtml
              ? `${node.label} · click for source`
              : `${node.label} · double-click to focus`
          }
          type="button"
        >
          {isHtml ? (
            <div className="min-w-0 space-y-0.5">
              <div className="flex min-w-0 flex-wrap items-center gap-1">
                <span className="shrink-0 font-mono text-[11px] font-semibold leading-tight">
                  {node.label}
                </span>
                <HtmlDisplayBadges hasChildren={hasChildren} node={node} />
                {htmlDisplay?.primaryHint ? (
                  <span className="min-w-0 truncate font-mono text-[9px] leading-tight text-violet-800/90">
                    {htmlDisplay.primaryHint}
                  </span>
                ) : null}
              </div>
              {htmlDisplay?.secondaryLine ? (
                <div className="truncate font-mono text-[9px] leading-tight text-muted-foreground">
                  {htmlDisplay.secondaryLine}
                </div>
              ) : null}
            </div>
          ) : (
            <>
              <span className="block truncate text-xs font-semibold">
                {node.label}
              </span>
              <span className="mt-0.5 flex flex-wrap items-center gap-1">
                <span
                  className={[
                    "rounded px-1 py-0.5 font-mono text-[9px] uppercase",
                    TYPE_BADGE[nodeTypeBadge(node)] ??
                      "bg-muted text-muted-foreground",
                  ].join(" ")}
                >
                  {nodeTypeBadge(node)}
                </span>
                {localsCount(treeNode.locals) > 0 ? (
                  <span className="text-[9px] text-emerald-700">
                    {localsCount(treeNode.locals)} locals
                  </span>
                ) : null}
                {hasGate ? (
                  <span className="text-[9px] text-amber-700">gated</span>
                ) : null}
                {treeNode.children.length > 0 ? (
                  <span className="text-[9px] text-muted-foreground">
                    {treeNode.children.length} nested
                  </span>
                ) : null}
              </span>
              {node.props && node.props.length > 0 ? (
                <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground">
                  {node.props
                    .map((prop) => `${prop.name}={${prop.expression}}`)
                    .join(" · ")}
                </span>
              ) : null}
            </>
          )}
        </button>
      </div>

      {hasChildren && expanded ? (
        <div className="space-y-2 p-2">
          <CardBody
            activeTrace={activeTrace}
            compact
            graph={graph}
            onOpenDataTrace={onOpenDataTrace}
            onOpenSourceLocal={onOpenSourceLocal}
            onOpenSourceNode={onOpenSourceNode}
            onTraceHook={onTraceHook}
            showGateConditions
            treeNode={treeNode}
          />
          {treeNode.children.length > 0 ? (
            <div className="w-full rounded-md border border-dashed bg-muted/10 p-2">
              <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {childrenSectionLabel(treeNode.children, htmlChildMode)}
              </p>
              <ChildCardsGrid
                activeTrace={activeTrace}
                children={treeNode.children}
                expandedChildIds={expandedChildIds}
                expandingNodeId={expandingNodeId}
                focusRootId={focusRootId}
                graph={graph}
                htmlChildModes={htmlChildModes}
                onExpandNode={onExpandNode}
                onFocusComponent={onFocusComponent}
                onOpenSourceLocal={onOpenSourceLocal}
                onOpenSourceNode={onOpenSourceNode}
                onSelectNode={onSelectNode}
                onToggleChild={onToggleChild}
                onToggleHtmlChildMode={onToggleHtmlChildMode}
                onOpenDataTrace={onOpenDataTrace}
                onTraceHook={onTraceHook}
                parentTreeNode={treeNode}
                search={search}
                selectedNodeId={selectedNodeId}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

const UiParentCard = ({
  treeNode,
  expandedChildIds,
  focusRootId,
  graph,
  htmlChildModes,
  onToggleChild,
  onToggleHtmlChildMode,
  search,
  selectedNodeId,
  expandingNodeId,
  activeTrace,
  onSelectNode,
  onOpenSourceNode,
  onOpenSourceLocal,
  onExpandNode,
  onOpenDataTrace,
  onFocusComponent,
  onTraceHook,
}: {
  treeNode: UiTreeNode;
  expandedChildIds: Set<string>;
  focusRootId: string;
  graph: PageLogicGraph;
  htmlChildModes: Map<string, HtmlChildViewMode>;
  onToggleChild: (nodeId: string) => void;
  onToggleHtmlChildMode: (nodeId: string) => void;
  search: string;
  selectedNodeId: string | null;
  expandingNodeId: string | null;
  activeTrace: DataTraceChain | null;
  onSelectNode: (nodeId: string) => void;
  onOpenSourceNode: (nodeId: string) => void;
  onOpenSourceLocal: (
    consumerNodeId: string,
    item: UiLocalItem,
    tone: LocalItemTone
  ) => void;
  onExpandNode: (node: LogicGraphNode) => void | Promise<void>;
  onOpenDataTrace: (
    expression: string,
    consumerNodeId: string,
    options?: { propName?: string; variableName?: string }
  ) => void;
  onFocusComponent: (node: LogicGraphNode) => void | Promise<void>;
  onTraceHook: (
    request: HookTraceRequest
  ) => void | Promise<void> | Promise<HookTraceView | undefined>;
}) => {
  const { node } = treeNode;
  const isOnTracePath = activeTrace?.highlightedUiNodeIds.includes(
    treeNode.nodeId
  );

  if (!subtreeMatchesSearch(treeNode, search)) {
    return null;
  }

  return (
    <div
      className={[
        "w-full overflow-hidden rounded-xl border-2 bg-card shadow-md transition-all",
        cardHighlightClass(treeNode.nodeId, selectedNodeId, activeTrace),
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-3 border-b bg-muted/40 px-4 py-3">
        <button
          className="min-w-0 flex-1 text-start"
          onClick={() => onSelectNode(treeNode.nodeId)}
          onDoubleClick={openSourceOnDoubleClick(() =>
            onOpenSourceNode(treeNode.nodeId)
          )}
          title={`${node.label} · double-click for source`}
          type="button"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold">{node.label}</span>
            <span
              className={[
                "rounded px-2 py-0.5 font-mono text-[10px] uppercase",
                TYPE_BADGE[nodeTypeBadge(node)] ??
                  "bg-muted text-muted-foreground",
              ].join(" ")}
            >
              {nodeTypeBadge(node)}
            </span>
            {isOnTracePath ? (
              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-700">
                trace path
              </span>
            ) : null}
          </div>
        </button>
      </div>

      <CardBody
        activeTrace={activeTrace}
        graph={graph}
        onOpenDataTrace={onOpenDataTrace}
        onOpenSourceLocal={onOpenSourceLocal}
        onOpenSourceNode={onOpenSourceNode}
        onTraceHook={onTraceHook}
        showGateConditions={false}
        treeNode={treeNode}
      />

      <section className="border-t bg-muted/15 px-4 py-3">
        <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {childrenSectionLabel(
            treeNode.children,
            isHtmlUiNode(treeNode.node)
              ? (htmlChildModes.get(treeNode.nodeId) ?? "elements")
              : "elements"
          )}
        </h4>
        <ChildCardsGrid
          activeTrace={activeTrace}
          children={treeNode.children}
          expandedChildIds={expandedChildIds}
          expandingNodeId={expandingNodeId}
          focusRootId={focusRootId}
          graph={graph}
          htmlChildModes={htmlChildModes}
          onExpandNode={onExpandNode}
          onFocusComponent={onFocusComponent}
          onOpenSourceLocal={onOpenSourceLocal}
          onOpenSourceNode={onOpenSourceNode}
          onSelectNode={onSelectNode}
          onToggleChild={onToggleChild}
          onToggleHtmlChildMode={onToggleHtmlChildMode}
          onOpenDataTrace={onOpenDataTrace}
          onTraceHook={onTraceHook}
          parentTreeNode={treeNode}
          search={search}
          selectedNodeId={selectedNodeId}
        />
      </section>
    </div>
  );
};

export function UiGraphViewer({
  graph,
  focusRootId: focusRootIdProp,
  selectedNodeId,
  search,
  expandingNodeId,
  onSelectNode,
  onOpenSourceNode,
  onOpenSourceLocal,
  onExpandNode,
  activeTrace,
  onTraceData,
  onTraceHook,
  onFocusRootChange,
}: UiGraphViewerProps) {
  const uiTree = useMemo(() => buildUiTree(graph), [graph]);
  const [focusRootId, setFocusRootId] = useState<string>(
    () => focusRootIdProp ?? graph.rootNodeId
  );
  const [expandedChildIds, setExpandedChildIds] = useState<Set<string>>(
    () => new Set()
  );
  const [htmlChildModes, setHtmlChildModes] = useState<
    Map<string, HtmlChildViewMode>
  >(() => new Map());

  useEffect(() => {
    setFocusRootId(focusRootIdProp ?? graph.rootNodeId);
    setExpandedChildIds(new Set());
    setHtmlChildModes(new Map());
  }, [focusRootIdProp, graph.rootNodeId]);

  useEffect(() => {
    if (!uiTree || !activeTrace) {
      return;
    }

    const toExpand = new Set<string>();
    for (const nodeId of activeTrace.highlightedUiNodeIds) {
      const path = findUiTreeNodePath(uiTree, nodeId);
      if (!path) {
        continue;
      }
      for (const node of path.slice(0, -1)) {
        toExpand.add(node.nodeId);
      }
    }

    if (toExpand.size === 0) {
      return;
    }

    setExpandedChildIds((current) => new Set([...current, ...toExpand]));
  }, [activeTrace, uiTree]);

  useEffect(() => {
    const query = search.trim().toLowerCase();
    if (!uiTree || !query) {
      return;
    }

    const flat = flattenUiTree(uiTree);
    const matching = flat.filter((node) => matchesSearch(node, query));
    if (matching.length === 0) {
      return;
    }

    const best =
      matching.find((node) => node.node.label.toLowerCase() === query) ??
      matching.find((node) => node.node.label.toLowerCase().includes(query)) ??
      matching[0];
    if (!best) {
      return;
    }

    const path = findUiTreeNodePath(uiTree, best.nodeId);
    if (!path || path.length === 0) {
      return;
    }

    const focusTarget = path.length >= 2 ? path.at(-2)! : path.at(-1)!;
    setFocusRootId(focusTarget.nodeId);

    setExpandedChildIds(() => {
      const next = new Set<string>();
      for (const node of path.slice(0, -1)) {
        next.add(node.nodeId);
      }
      return next;
    });

    onSelectNode(best.nodeId);
  }, [onSelectNode, search, uiTree]);

  const focusedTree = useMemo(() => {
    if (!uiTree) {
      return null;
    }
    return findUiTreeNode(uiTree, focusRootId) ?? uiTree;
  }, [focusRootId, uiTree]);

  const focusComponent = useCallback(
    async (node: LogicGraphNode) => {
      if (isNodeExpandable(node) && !node.metadata?.expanded) {
        await Promise.resolve(onExpandNode(node));
      }
      setFocusRootId(node.id);
      setExpandedChildIds(new Set());
      onSelectNode(node.id);
      onFocusRootChange?.(node.id);
    },
    [onExpandNode, onFocusRootChange, onSelectNode]
  );

  const openDataTrace = (
    expression: string,
    consumerNodeId: string,
    options?: { propName?: string; variableName?: string }
  ) => {
    onTraceData(expression, consumerNodeId, options);
  };

  const toggleChild = (nodeId: string) => {
    setExpandedChildIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  const toggleHtmlChildMode = useCallback((nodeId: string) => {
    setHtmlChildModes((current) => {
      const next = new Map(current);
      const mode = next.get(nodeId) ?? "elements";
      next.set(nodeId, mode === "elements" ? "components" : "elements");
      return next;
    });
  }, []);

  if (!uiTree || !focusedTree) {
    return (
      <div className="rounded-lg border p-6 text-sm text-muted-foreground">
        No UI tree found for this graph.
      </div>
    );
  }

  return (
    <div className="w-full space-y-3">
      <UiParentCard
        activeTrace={activeTrace}
        expandedChildIds={expandedChildIds}
        expandingNodeId={expandingNodeId}
        focusRootId={focusRootId}
        graph={graph}
        htmlChildModes={htmlChildModes}
        onExpandNode={onExpandNode}
        onFocusComponent={focusComponent}
        onOpenSourceLocal={onOpenSourceLocal}
        onOpenSourceNode={onOpenSourceNode}
        onSelectNode={onSelectNode}
        onToggleChild={toggleChild}
        onToggleHtmlChildMode={toggleHtmlChildMode}
        onOpenDataTrace={openDataTrace}
        onTraceHook={onTraceHook}
        search={search}
        selectedNodeId={selectedNodeId}
        treeNode={focusedTree}
      />
    </div>
  );
}
