"use client";

import type { PropInspectorView } from "@/lib/propTraceView";

interface PropsTraceInspectorProps {
  view: PropInspectorView;
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

export function PropsTraceInspector({ view }: PropsTraceInspectorProps) {
  return (
    <aside className="flex h-full min-h-0 flex-col rounded-lg border bg-card">
      <div className="shrink-0 border-b px-3 py-2">
        <p className="text-xs font-semibold">Inspector</p>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <DetailRow label="Prop" value={view.propName} />
        <DetailRow label="Component" value={view.componentLabel} />
        <DetailRow label="Type" value={view.propKind ?? "unknown"} />
        <DetailRow label="Source" value={view.expression} />

        <section className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Used in
          </p>
          {view.usedIn.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Not referenced in conditions, loops, or events in this component.
            </p>
          ) : (
            <ul className="space-y-1">
              {view.usedIn.map((site, index) => (
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

        <section className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Passed to
          </p>
          {view.passedTo.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Not passed to child components.
            </p>
          ) : (
            <ul className="space-y-1">
              {view.passedTo.map((pass) => (
                <li
                  className="rounded border bg-muted/30 px-2 py-1.5 text-xs"
                  key={`${pass.childNodeId}:${pass.propName}`}
                >
                  <span className="font-medium">{pass.childLabel}</span>
                  <span className="mt-0.5 block font-mono text-[10px]">
                    {pass.propName} ← {pass.expression}
                  </span>
                  {pass.renamed ? (
                    <span className="mt-0.5 block text-[10px] text-amber-700">
                      Renamed from {view.propName}
                    </span>
                  ) : (
                    <span className="mt-0.5 block text-[10px] text-muted-foreground">
                      Same prop name
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-1 rounded-md border border-dashed p-3 text-[11px] text-muted-foreground">
          <p className="font-medium text-foreground">Answers</p>
          <ul className="list-inside list-disc space-y-0.5">
            <li>
              Receives <code>{view.propName}</code> via{" "}
              <code>{view.expression}</code>
            </li>
            <li>
              Used in {view.usedIn.length} site
              {view.usedIn.length === 1 ? "" : "s"} inside the component
            </li>
            <li>
              Passed to {view.passedTo.length} child prop
              {view.passedTo.length === 1 ? "" : "s"}
            </li>
            <li>
              {view.passedTo.some((pass) => pass.renamed)
                ? "Renamed when passed down"
                : "Not renamed when passed down"}
            </li>
          </ul>
        </section>
      </div>
    </aside>
  );
}
