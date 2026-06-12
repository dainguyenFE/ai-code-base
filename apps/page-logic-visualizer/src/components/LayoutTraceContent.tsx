"use client";

import type {
  LayoutDataSourceTrace,
  LayoutDiagnostic,
  LayoutGuardTrace,
  LayoutProviderTrace,
  LayoutRenderTrace,
  LayoutSlotTrace,
  LayoutTrace,
} from "@cs/page-logic-visualizer/client";
import type { ReactNode } from "react";

interface LayoutTraceContentProps {
  trace: LayoutTrace;
}

const CLASSIFICATION_LABEL: Record<
  NonNullable<LayoutRenderTrace["classification"]>,
  string
> = {
  component: "Component",
  "overlay-ui": "Overlay",
  "persistent-ui": "Global UI",
  unknown: "UI",
};

const TraceSection = ({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) => (
  <section className="space-y-1.5">
    <h4 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
      {title}
    </h4>
    {children}
  </section>
);

const ItemRow = ({
  label,
  detail,
  meta,
  tone = "default",
}: {
  label: string;
  detail?: string;
  meta?: string;
  tone?: "default" | "slot" | "guard" | "data" | "provider" | "warning";
}) => {
  const toneClass =
    tone === "slot"
      ? "border-violet-500/40 bg-violet-500/5"
      : tone === "guard"
        ? "border-amber-500/40 bg-amber-500/5"
        : tone === "data"
          ? "border-emerald-500/40 bg-emerald-500/5"
          : tone === "provider"
            ? "border-sky-500/40 bg-sky-500/5"
            : tone === "warning"
              ? "border-amber-500/40 bg-amber-500/5"
              : "border-border bg-background";

  return (
    <div className={`rounded border px-2 py-1.5 text-xs ${toneClass}`}>
      <div className="font-medium">{label}</div>
      {detail ? (
        <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
          {detail}
        </div>
      ) : null}
      {meta ? (
        <div className="mt-0.5 text-[10px] text-muted-foreground">{meta}</div>
      ) : null}
    </div>
  );
};

const renderSlot = (slot: LayoutSlotTrace) => {
  const target =
    slot.target && slot.targetKind
      ? `${slot.targetKind}: ${slot.target}`
      : slot.target;

  return (
    <ItemRow
      detail={
        slot.renderedAt?.code ??
        (slot.rendered ? "Rendered in JSX" : "Not rendered")
      }
      key={`${slot.name}-${slot.renderedAt?.line ?? "missing"}`}
      label={
        target
          ? `Slot: ${slot.name} → ${target}`
          : `Slot: ${slot.name}${slot.rendered ? "" : " (missing)"}`
      }
      meta={slot.renderedAt?.line ? `line ${slot.renderedAt.line}` : undefined}
      tone="slot"
    />
  );
};

const renderProvider = (provider: LayoutProviderTrace) => (
  <ItemRow
    key={`${provider.name}-${provider.line}`}
    label={provider.name}
    meta={provider.wrapsChildren ? "Provider · wraps children" : "Provider"}
    tone="provider"
  />
);

const renderRender = (item: LayoutRenderTrace) => (
  <ItemRow
    detail={
      item.props
        ? Object.entries(item.props)
            .slice(0, 3)
            .map(([key, value]) => `${key}=${value}`)
            .join(" · ")
        : undefined
    }
    key={`${item.component}-${item.line}`}
    label={item.component}
    meta={
      item.classification
        ? CLASSIFICATION_LABEL[item.classification]
        : undefined
    }
  />
);

const renderDataSource = (source: LayoutDataSourceTrace) => (
  <ItemRow
    key={`${source.call}-${source.line}`}
    label={source.call}
    meta={source.line ? `line ${source.line}` : undefined}
    tone="data"
  />
);

const renderGuard = (guard: LayoutGuardTrace) => (
  <ItemRow
    detail={guard.target}
    key={`${guard.action}-${guard.line}`}
    label={
      guard.condition
        ? `Guard: ${guard.condition} → ${guard.action}()`
        : guard.action
    }
    meta={guard.line ? `line ${guard.line}` : undefined}
    tone="guard"
  />
);

const renderDiagnostic = (diagnostic: LayoutDiagnostic) => (
  <ItemRow
    key={`${diagnostic.level}-${diagnostic.message}`}
    label={diagnostic.message}
    meta={diagnostic.line ? `line ${diagnostic.line}` : diagnostic.level}
    tone={diagnostic.level === "warning" ? "warning" : "default"}
  />
);

export function LayoutTraceContent({ trace }: LayoutTraceContentProps) {
  const propsSummary = trace.props.map((prop) => prop.name).join(", ");

  const orderedItems: ReactNode[] = [];

  for (const source of trace.dataSources) {
    orderedItems.push(renderDataSource(source));
  }
  for (const provider of trace.providers) {
    orderedItems.push(renderProvider(provider));
  }
  for (const render of trace.renders) {
    orderedItems.push(renderRender(render));
  }
  for (const slot of trace.slots) {
    orderedItems.push(renderSlot(slot));
  }
  for (const guard of trace.guards) {
    orderedItems.push(renderGuard(guard));
  }

  return (
    <div className="mt-3 space-y-3 border-t pt-3">
      <div className="flex flex-wrap gap-2 text-[10px] text-muted-foreground">
        {trace.layout.routeSegment ? (
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono">
            segment: {trace.layout.routeSegment}
          </span>
        ) : null}
        {trace.layout.isRootLayout ? (
          <span className="rounded bg-muted px-1.5 py-0.5">root layout</span>
        ) : null}
        {trace.layout.isClientComponent ? (
          <span className="rounded bg-muted px-1.5 py-0.5">client</span>
        ) : null}
        {trace.metadata?.kind && trace.metadata.kind !== "none" ? (
          <span className="rounded bg-muted px-1.5 py-0.5">
            metadata: {trace.metadata.kind}
          </span>
        ) : null}
        {trace.segmentConfig?.dynamic ? (
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono">
            dynamic={trace.segmentConfig.dynamic}
          </span>
        ) : null}
      </div>

      {propsSummary ? (
        <TraceSection title="Props">
          <p className="font-mono text-xs">{propsSummary}</p>
        </TraceSection>
      ) : null}

      {orderedItems.length > 0 ? (
        <TraceSection title="Layout trace">
          <div className="space-y-1.5">{orderedItems}</div>
        </TraceSection>
      ) : null}

      {trace.diagnostics.length > 0 ? (
        <TraceSection title="Diagnostics">
          <div className="space-y-1.5">
            {trace.diagnostics.map(renderDiagnostic)}
          </div>
        </TraceSection>
      ) : null}
    </div>
  );
}
