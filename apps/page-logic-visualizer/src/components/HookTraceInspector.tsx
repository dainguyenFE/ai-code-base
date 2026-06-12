"use client";

import type { HookTraceView } from "@cs/page-logic-visualizer/client";

interface HookTraceInspectorProps {
  trace: HookTraceView;
  consumerLabel?: string;
  siblingHooks?: { hookNodeId: string; label: string }[];
  activeHookNodeId?: string;
  onSelectSiblingHook?: (hookNodeId: string) => void;
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
    <div className="space-y-0.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="font-mono text-xs">{value}</p>
    </div>
  );
};

export function HookTraceInspector({
  trace,
  consumerLabel,
  siblingHooks = [],
  activeHookNodeId,
  onSelectSiblingHook,
}: HookTraceInspectorProps) {
  const hookTitle = trace.bindingVariable
    ? `${trace.bindingVariable} ← ${trace.hookName}()`
    : `${trace.hookName}()`;

  return (
    <aside className="flex h-full min-h-0 flex-col rounded-lg border bg-card">
      <div className="shrink-0 border-b px-3 py-2">
        <p className="text-xs font-semibold">Inspector</p>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <section className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Hook
          </p>
          <DetailRow label="Call" value={hookTitle} />
          <DetailRow label="Expression" value={trace.callExpression} />
          <DetailRow label="Component" value={consumerLabel} />
          <DetailRow
            label="Definition"
            value={trace.definitionSymbol ?? trace.hookName}
          />
          <DetailRow label="File" value={trace.definitionFilePath} />
        </section>

        {siblingHooks.length > 1 ? (
          <section className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Hooks in component
            </p>
            <ul className="flex flex-wrap gap-1.5">
              {siblingHooks.map((hook) => (
                <li key={hook.hookNodeId}>
                  <button
                    className={[
                      "rounded-full border px-2 py-0.5 font-mono text-[10px]",
                      hook.hookNodeId === (activeHookNodeId ?? trace.hookNodeId)
                        ? "border-primary bg-primary/10 font-semibold"
                        : "hover:bg-muted",
                    ].join(" ")}
                    onClick={() => onSelectSiblingHook?.(hook.hookNodeId)}
                    type="button"
                  >
                    {hook.label}()
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Trace structure
          </p>
          <ul className="space-y-1 text-[11px]">
            <li
              className={[
                "rounded border px-2 py-1",
                trace.inputs.length > 0
                  ? "bg-muted/30"
                  : "text-muted-foreground",
              ].join(" ")}
            >
              <span className="font-semibold">Input</span>
              {trace.inputs.length > 0
                ? ` — ${trace.inputs.map((input) => input.name).join(", ")}`
                : " — no parameters"}
            </li>
            <li className="rounded border bg-muted/30 px-2 py-1">
              <span className="font-semibold">Logic</span>
              {" — "}
              {(trace.internalHooks ?? []).filter(
                (entry) => entry.kind !== "return"
              ).length > 0
                ? (trace.internalHooks ?? [])
                    .filter((entry) => entry.kind !== "return")
                    .map((entry) =>
                      entry.hookName ? `${entry.hookName}()` : entry.name
                    )
                    .join(", ")
                : "direct return"}
            </li>
            <li className="rounded border bg-muted/30 px-2 py-1">
              <span className="font-semibold">Return</span>
              {trace.returnFields.length > 0
                ? ` — ${trace.returnFields.map((field) => field.name).join(", ")}`
                : " — void"}
            </li>
          </ul>
          {trace.focusedReturnField ? (
            <p className="text-[10px] text-amber-700">
              Upstream scope:{" "}
              <span className="font-mono font-semibold">
                {trace.focusedReturnField}
              </span>
            </p>
          ) : null}
        </section>

        {trace.returnFields.length > 0 ? (
          <section className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Return fields
            </p>
            <ul className="space-y-1">
              {trace.returnFields.map((field) => (
                <li
                  className={[
                    "rounded border px-2 py-1 font-mono text-[11px]",
                    trace.focusedReturnField === field.name
                      ? "border-amber-500/50 bg-amber-500/10 font-semibold"
                      : "bg-muted/30",
                  ].join(" ")}
                  key={field.name}
                >
                  {field.name}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {trace.effects.length > 0 ? (
          <section className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Effects
            </p>
            <ul className="space-y-1">
              {trace.effects.map((effect) => (
                <li
                  className="rounded border bg-muted/30 px-2 py-1 font-mono text-[11px]"
                  key={effect.hookName}
                >
                  {effect.hookName}()
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {trace.warnings && trace.warnings.length > 0 ? (
          <section className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Warnings
            </p>
            <ul className="space-y-1">
              {trace.warnings.map((warning, index) => (
                <li
                  className={[
                    "rounded border px-2 py-1 text-[10px]",
                    warning.level === "error"
                      ? "border-red-500/40 bg-red-500/10 text-red-800"
                      : (warning.level === "warning"
                        ? "border-amber-500/40 bg-amber-500/10 text-amber-800"
                        : "border-slate-500/40 bg-muted/30 text-muted-foreground"),
                  ].join(" ")}
                  key={`${warning.message}:${index}`}
                >
                  {warning.message}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </aside>
  );
}
