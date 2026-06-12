"use client";

import { Handle, NodeResizer, Position } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";
import { memo } from "react";

import { PropFlowCodePreview } from "@/components/PropFlowCodePreview";
import { countTraceableInSubtree } from "@/lib/collectTraceExpandAllIds";
import {
  getCodePreviewText,
  getNodeHeadline,
  shouldShowCodePreview,
} from "@/lib/propFlowNodeDisplay";
import type { PropFlowStepNodeData } from "@/lib/propFlowToReactFlow";
import {
  PROP_FLOW_AWAIT_JOIN_HEIGHT,
  PROP_FLOW_NODE_HEIGHT,
  PROP_FLOW_NODE_WIDTH,
  readNodeHeight,
  readNodeWidth,
} from "@/lib/propFlowToReactFlow";

const ROLE_STYLES: Record<string, string> = {
  "api-call": "border-emerald-500/50 bg-emerald-500/10",
  assign: "border-sky-500/50 bg-sky-500/10",
  "await-call": "border-emerald-500/50 bg-emerald-500/10",
  "await-join": "border-violet-500/50 bg-violet-500/15",
  branch: "border-amber-500/50 bg-amber-500/10",
  call: "border-cyan-500/50 bg-cyan-500/10",
  catch: "border-rose-500/50 bg-rose-500/10",
  context: "border-fuchsia-500/50 bg-fuchsia-500/10",
  derive: "border-indigo-500/50 bg-indigo-500/15",
  function: "border-cyan-500/50 bg-cyan-500/10",
  hook: "border-violet-500/50 bg-violet-500/10",
  "if-false": "border-slate-500/50 bg-slate-500/10",
  "if-true": "border-emerald-600/50 bg-emerald-500/10",
  join: "border-amber-500/40 bg-amber-500/5",
  literal: "border-amber-500/50 bg-amber-500/10",
  loop: "border-orange-500/50 bg-orange-500/10",
  "pass-down": "border-sky-500/50 bg-sky-500/10",
  "promise-all": "border-amber-500/50 bg-amber-500/10",
  prop: "border-slate-500/50 bg-slate-500/10",
  resume: "border-violet-500/40 bg-violet-500/10",
  return: "border-indigo-500/50 bg-indigo-500/10",
  "switch-case": "border-amber-500/50 bg-amber-500/10",
  "switch-default": "border-orange-500/50 bg-orange-500/10",
  try: "border-emerald-600/50 bg-emerald-500/10",
  variable: "border-indigo-500/50 bg-indigo-500/10",
};

const EXECUTION_BADGE: Record<string, string> = {
  async: "border-sky-500/40 bg-sky-500/15 text-sky-700 dark:text-sky-300",
  await:
    "border-violet-500/40 bg-violet-500/15 text-violet-700 dark:text-violet-300",
  sync: "border-slate-500/40 bg-slate-500/15 text-slate-700 dark:text-slate-300",
};

type PropFlowStepNodeType = Node<PropFlowStepNodeData, "propFlowStep">;

const iconClass = (compact: boolean) => (compact ? "h-3 w-3" : "h-3.5 w-3.5");

function IconChevronsDown({ compact }: { compact: boolean }) {
  return (
    <svg
      aria-hidden
      className={iconClass(compact)}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      viewBox="0 0 24 24"
    >
      <path d="m7 6 5 5 5-5" />
      <path d="m7 13 5 5 5-5" />
    </svg>
  );
}

function IconChevronDown({ compact }: { compact: boolean }) {
  return (
    <svg
      aria-hidden
      className={iconClass(compact)}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      viewBox="0 0 24 24"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function IconChevronUp({ compact }: { compact: boolean }) {
  return (
    <svg
      aria-hidden
      className={iconClass(compact)}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      viewBox="0 0 24 24"
    >
      <path d="m18 15-6-6-6 6" />
    </svg>
  );
}

function PropFlowTraceRail({
  compact,
  flowNodeId,
  isTraced,
  onExpandAll,
  onTraceToggle,
  traceableCount,
}: {
  compact: boolean;
  flowNodeId: string;
  isTraced: boolean;
  onExpandAll?: (nodeId: string) => void;
  onTraceToggle?: (nodeId: string) => void;
  traceableCount: number;
}) {
  const canExpandAll = traceableCount > 1;
  const railWidth = compact ? "w-5" : "w-6";

  const buttonClass = (active: boolean, disabled: boolean) =>
    [
      "nodrag nopan flex items-center justify-center rounded-sm transition-colors",
      compact ? "h-4 w-4" : "h-5 w-5",
      disabled
        ? "cursor-not-allowed text-muted-foreground/30"
        : (active
          ? "text-primary hover:bg-primary/15"
          : "text-muted-foreground hover:bg-muted/80 hover:text-foreground"),
    ].join(" ");

  return (
    <div
      className={[
        "flex shrink-0 flex-col items-center justify-center gap-0.5 self-stretch border-l border-border/70 bg-muted/40",
        compact ? "px-0 py-0.5" : "px-0.5 py-1",
        railWidth,
      ].join(" ")}
    >
      <button
        className={buttonClass(false, !canExpandAll)}
        disabled={!canExpandAll}
        title={
          canExpandAll
            ? `Expand all (${traceableCount})`
            : "No nested trace targets"
        }
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          if (canExpandAll) {
            onExpandAll?.(flowNodeId);
          }
        }}
      >
        <IconChevronsDown compact={compact} />
      </button>
      <button
        className={buttonClass(!isTraced, isTraced)}
        disabled={isTraced}
        title={isTraced ? "Already expanded" : "Expand body"}
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          if (!isTraced) {
            onTraceToggle?.(flowNodeId);
          }
        }}
      >
        <IconChevronDown compact={compact} />
      </button>
      <button
        className={buttonClass(isTraced, !isTraced)}
        disabled={!isTraced}
        title={isTraced ? "Collapse" : "Not expanded"}
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          if (isTraced) {
            onTraceToggle?.(flowNodeId);
          }
        }}
      >
        <IconChevronUp compact={compact} />
      </button>
    </div>
  );
}

function PropFlowStepNodeCardComponent(props: NodeProps<PropFlowStepNodeType>) {
  const { data, selected } = props;
  const {
    flowNode,
    canTrace,
    isTraced,
    isNested,
    nestedHeight = 0,
    childrenPending,
    onTraceToggle,
    onExpandAll,
  } = data;
  const roleStyle =
    ROLE_STYLES[flowNode.stepRole ?? ""] ?? "border-border bg-background";
  const highlighted = selected || data.focused;
  const originHighlighted = Boolean(flowNode.originHighlight);
  const isAwaitJoin = flowNode.stepRole === "await-join";
  const isExpandedParent =
    !isNested && isTraced && nestedHeight > 0 && canTrace;
  const showCodePreview = shouldShowCodePreview(flowNode);
  const headline = getNodeHeadline(flowNode);
  const traceableCount = canTrace ? countTraceableInSubtree(flowNode) : 0;

  const nodeWidth = readNodeWidth(props);
  const nodeHeight = readNodeHeight(props);

  const minWidth = isNested ? 140 : PROP_FLOW_NODE_WIDTH;
  const minHeight = isNested
    ? 48
    : isAwaitJoin
      ? PROP_FLOW_AWAIT_JOIN_HEIGHT
      : isExpandedParent
        ? nodeHeight
        : PROP_FLOW_NODE_HEIGHT;

  return (
    <>
      <NodeResizer
        handleClassName="!z-20 !h-2.5 !w-2.5 !rounded-sm !border-2 !border-primary !bg-background"
        isVisible={selected}
        lineClassName="!border-primary/50"
        minHeight={minHeight}
        minWidth={minWidth}
      />

      <div
        className={[
          "relative box-border flex h-full w-full overflow-hidden rounded-lg border shadow-sm",
          roleStyle,
          highlighted ? "ring-2 ring-primary" : "",
          originHighlighted && !highlighted
            ? "ring-2 ring-amber-500/80 bg-amber-500/5"
            : "",
          originHighlighted && highlighted
            ? "ring-2 ring-amber-500 ring-offset-1"
            : "",
          isExpandedParent ? "bg-card/95" : "",
        ].join(" ")}
        style={{
          height: nodeHeight,
          width: isNested ? "100%" : nodeWidth,
        }}
      >
        <Handle
          className="!z-10 !h-2 !w-2 !border-background"
          position={Position.Top}
          type="target"
        />

        <div
          className={[
            "flex min-w-0 flex-1 flex-col",
            isNested ? "px-2 py-1.5" : "px-3 py-2",
            isAwaitJoin || isNested ? "text-left" : "",
          ].join(" ")}
        >
          <div className="flex min-w-0 items-center justify-between gap-1">
            <span className="truncate font-mono text-[9px] uppercase text-muted-foreground">
              {flowNode.stepRole ?? "step"}
            </span>
            {flowNode.executionKind ? (
              <span
                className={[
                  "shrink-0 rounded border px-1 font-mono text-[8px] font-semibold uppercase",
                  EXECUTION_BADGE[flowNode.executionKind] ?? "",
                ].join(" ")}
              >
                {flowNode.executionKind}
              </span>
            ) : null}
          </div>

          {showCodePreview ? (
            <PropFlowCodePreview
              className={isNested ? "mt-1 text-[10px]" : "mt-1 text-xs"}
              text={getCodePreviewText(flowNode)}
            />
          ) : (headline ? (
            <p
              className={[
                "mt-1 truncate font-mono font-medium leading-snug",
                isNested ? "text-[10px]" : "text-xs",
              ].join(" ")}
              title={headline}
            >
              {headline}
            </p>
          ) : null)}

          {flowNode.propOutcome ? (
            <PropFlowCodePreview
              className="mt-1 rounded border border-primary/20 bg-primary/5 px-1.5 py-0.5 text-[10px] text-primary"
              text={flowNode.propOutcome}
            />
          ) : null}

          {flowNode.detail ? (
            <PropFlowCodePreview
              className="mt-0.5 text-[10px] text-muted-foreground"
              text={flowNode.detail}
            />
          ) : null}

          {isExpandedParent ? (
            <div
              aria-hidden
              className="pointer-events-none mt-2 flex min-h-0 flex-1 flex-col rounded-md border border-dashed border-border/50 bg-muted/5"
              style={{ minHeight: Math.max(nestedHeight, 80) }}
            >
              {childrenPending ? (
                <span className="px-2 py-1 font-mono text-[9px] text-muted-foreground">
                  sizing…
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        {canTrace ? (
          <PropFlowTraceRail
            compact={Boolean(isNested)}
            flowNodeId={flowNode.id}
            isTraced={Boolean(isTraced)}
            onExpandAll={onExpandAll}
            onTraceToggle={onTraceToggle}
            traceableCount={traceableCount}
          />
        ) : null}

        <Handle
          className="!z-10 !h-2 !w-2 !border-background"
          position={Position.Bottom}
          type="source"
        />
      </div>
    </>
  );
}

export const PropFlowStepNodeCard = memo(PropFlowStepNodeCardComponent);

export const PropFlowStepNode = PropFlowStepNodeCard;
