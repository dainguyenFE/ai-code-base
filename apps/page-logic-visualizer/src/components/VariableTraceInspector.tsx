"use client";

import type { VariableInspectorView } from "@/lib/variableTraceView";

interface VariableTraceInspectorProps {
  view: VariableInspectorView;
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

const USAGE_KIND_LABEL: Record<string, string> = {
  condition: "Condition",
  event: "Event",
  loop: "Loop / map",
  render: "Render",
  variable: "Variable",
};

export function VariableTraceInspector({ view }: VariableTraceInspectorProps) {
  const usedIn = view.usedIn ?? [];

  return (
    <aside className="flex h-full min-h-0 flex-col rounded-lg border bg-card">
      <div className="shrink-0 border-b px-3 py-2">
        <p className="text-xs font-semibold">Inspector</p>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <section className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Origin
          </p>
          <DetailRow label="Variable" value={view.variableName} />
          <DetailRow label="Component" value={view.componentLabel} />
          <DetailRow label="Declaration" value={view.expression} />
          {view.sourceHook ? (
            <DetailRow label="From hook" value={view.sourceHook} />
          ) : null}
        </section>

        <section className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Used in
          </p>
          <p className="text-[11px] text-muted-foreground">
            Where this variable affects render, hooks, or callbacks in the
            component.
          </p>
          {usedIn.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Not referenced in conditions, loops, or events in this component.
            </p>
          ) : (
            <ul className="space-y-1">
              {usedIn.map((site, index) => (
                <li
                  className="rounded border bg-muted/30 px-2 py-1.5 text-xs"
                  key={`${site.kind}:${site.label}:${index}`}
                >
                  <span className="font-medium">
                    {USAGE_KIND_LABEL[site.kind] ?? site.kind}
                  </span>
                  <span className="mt-0.5 block font-mono text-[10px]">
                    {site.label}
                  </span>
                  {site.detail ? (
                    <span className="mt-0.5 block text-[10px] text-muted-foreground">
                      {site.detail}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </aside>
  );
}
