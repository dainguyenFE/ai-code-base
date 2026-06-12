"use client";

import type {
  DataTraceChain,
  DataTraceHookTraceAction,
  DataTraceStep,
  HookTraceView,
} from "@cs/page-logic-visualizer/client";
import { useEffect, useRef } from "react";
import type { RefObject } from "react";

import type { TraceStepFocusMeta } from "@/lib/sourceView";
import { traceStepFocusMeta } from "@/lib/sourceView";

import type { HookTraceRequest } from "./UiGraphViewer";

const TRACE_STEP_STYLES: Record<string, string> = {
  "api-call":
    "border-emerald-500/40 bg-emerald-500/10 ring-1 ring-emerald-500/20",
  "await-call":
    "border-emerald-500/40 bg-emerald-500/10 ring-1 ring-emerald-500/20",
  context: "border-teal-500/40 bg-teal-500/10",
  function: "border-cyan-500/40 bg-cyan-500/10",
  hardcode: "border-amber-500/40 bg-amber-500/10 ring-1 ring-amber-500/20",
  hook: "border-violet-500/40 bg-violet-500/10",
  literal: "border-amber-500/40 bg-amber-500/10 ring-1 ring-amber-500/20",
  "promise-all": "border-amber-500/40 bg-amber-500/10 ring-1 ring-amber-500/20",
  prop: "border-slate-500/40 bg-slate-500/10",
  store: "border-fuchsia-500/40 bg-fuchsia-500/10",
  variable: "border-indigo-500/40 bg-indigo-500/10",
};

const TRACE_STEP_LABELS: Record<string, string> = {
  "api-call": "API",
  "await-call": "fetch",
  context: "context",
  function: "calls",
  hardcode: "hard code",
  hook: "hook",
  literal: "literal",
  "promise-all": "parallel",
  prop: "prop",
  store: "store",
  variable: "data",
};

interface DataTraceSidebarProps {
  trace: DataTraceChain;
  focusedStepId?: string | null;
  onStepFocus: (nodeId: string, meta?: TraceStepFocusMeta) => void;
  onTraceHook?: (
    request: HookTraceRequest
  ) => void | Promise<void> | Promise<HookTraceView | undefined>;
}

const traceStepTitle = (step: DataTraceStep): string =>
  [step.label, step.detail].filter(Boolean).join(" · ");

const toHookTraceRequest = (
  action: DataTraceHookTraceAction
): HookTraceRequest => {
  if (action.mode === "hook") {
    return { hookNodeId: action.hookNodeId, mode: "hook" };
  }
  if (action.mode === "effect") {
    return {
      consumerNodeId: action.consumerNodeId,
      effectHookName: action.effectHookName,
      mode: "effect",
    };
  }
  return {
    consumerNodeId: action.consumerNodeId,
    fieldName: action.fieldName,
    mode: "local",
    sourceHook: action.sourceHook,
  };
};

const TraceStepButton = ({
  focusRef,
  focusedStepId,
  onStepFocus,
  onTraceHook,
  step,
}: {
  focusRef?: RefObject<HTMLButtonElement | null>;
  focusedStepId?: string | null;
  onStepFocus: DataTraceSidebarProps["onStepFocus"];
  onTraceHook?: DataTraceSidebarProps["onTraceHook"];
  step: DataTraceStep;
}) => {
  const hasHookTrace = Boolean(step.hookTrace && onTraceHook);
  const stepBorderClass =
    TRACE_STEP_STYLES[step.stepRole ?? ""] ??
    (step.isUiNode
      ? "border-sky-500/40 bg-sky-500/10"
      : "border-emerald-500/40 bg-emerald-500/10");

  return (
    <div className="min-w-0">
      <div
        className={[
          "flex min-w-0 items-center gap-1 overflow-hidden rounded border",
          stepBorderClass,
          focusedStepId === step.nodeId ? "ring-2 ring-amber-400" : "",
        ].join(" ")}
      >
        {hasHookTrace ? (
          <button
            aria-label="Open hook trace graph"
            className="flex size-6 shrink-0 items-center justify-center border-e bg-card text-[10px] hover:bg-accent"
            onClick={() =>
              void onTraceHook!(toHookTraceRequest(step.hookTrace!))
            }
            title="Open hook trace graph"
            type="button"
          >
            ↗
          </button>
        ) : null}
        <button
          className="relative min-w-0 flex-1 overflow-hidden px-1.5 py-1 text-start transition-all hover:brightness-95"
          onClick={() => onStepFocus(step.nodeId, traceStepFocusMeta(step))}
          ref={focusRef}
          title={traceStepTitle(step)}
          type="button"
        >
          <div className="flex min-w-0 items-center justify-between gap-1.5">
            <span className="shrink-0 font-mono text-[8px] uppercase leading-none text-muted-foreground">
              {(step.stepRole && TRACE_STEP_LABELS[step.stepRole]) ??
                (step.isUiNode ? "ui" : (step.kind ?? step.type))}
            </span>
            {step.executionKind === "await" ? (
              <span className="shrink-0 rounded border border-violet-500/40 bg-violet-500/15 px-0.5 py-px font-mono text-[8px] font-semibold uppercase leading-none text-violet-700 dark:text-violet-300">
                await
              </span>
            ) : (step.executionKind === "sync" ||
              step.executionKind === "async" ? (
              <span
                className={[
                  "shrink-0 rounded border px-0.5 py-px font-mono text-[8px] font-semibold uppercase leading-none",
                  step.executionKind === "async"
                    ? "border-sky-500/40 bg-sky-500/15 text-sky-700 dark:text-sky-300"
                    : "border-slate-500/40 bg-slate-500/15 text-slate-700 dark:text-slate-300",
                ].join(" ")}
              >
                {step.executionKind}
              </span>
            ) : null)}
          </div>
          <span className="mt-0.5 block min-w-0 truncate font-mono text-[10px] font-medium leading-tight">
            {step.label}
          </span>
          {step.detail ? (
            <span className="mt-0.5 block min-w-0 truncate font-mono text-[9px] leading-tight text-muted-foreground">
              {step.detail}
            </span>
          ) : null}
        </button>
      </div>
    </div>
  );
};

export function DataTraceSidebar({
  trace,
  focusedStepId,
  onStepFocus,
  onTraceHook,
}: DataTraceSidebarProps) {
  const focusedRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    focusedRef.current?.scrollIntoView({ block: "nearest" });
  }, [focusedStepId, trace.expression]);

  return (
    <aside className="flex w-[min(28rem,42vw)] min-w-[10rem] shrink-0 flex-col border-e bg-muted/10">
      <div className="shrink-0 border-b px-2.5 py-2">
        <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
          Data trace
        </p>
        <p
          className="mt-0.5 truncate font-mono text-[10px] font-medium"
          title={trace.expression}
        >
          {trace.expression}
        </p>
        {trace.consumerLabel ? (
          <p
            className="mt-0.5 truncate text-[9px] text-muted-foreground"
            title={`in ${trace.consumerLabel}`}
          >
            in {trace.consumerLabel}
          </p>
        ) : null}
      </div>
      <div className="overflow-y-auto overscroll-contain px-1.5 py-2">
        <ol className="flex w-full min-w-0 flex-col gap-1">
          {trace.steps.map((step, index) => (
            <li
              className="flex flex-col items-stretch"
              key={`${step.nodeId}:${index}`}
            >
              <TraceStepButton
                focusRef={
                  focusedStepId === step.nodeId ? focusedRef : undefined
                }
                focusedStepId={focusedStepId}
                onStepFocus={onStepFocus}
                onTraceHook={onTraceHook}
                step={step}
              />
            </li>
          ))}
        </ol>
      </div>
    </aside>
  );
}
