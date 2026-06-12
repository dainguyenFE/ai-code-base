import type { ExecutionStepRecord } from "@ai-trace/types";

const STEP_COLORS: Record<ExecutionStepRecord["kind"], string> = {
  branch: "#9a6700",
  call: "#0969da",
  hook: "#8250df",
  render: "#1a7f37",
  return: "#656d76",
};

const STEP_LABELS: Record<ExecutionStepRecord["kind"], string> = {
  branch: "Branch",
  call: "Call",
  hook: "Hook",
  render: "Render",
  return: "Return",
};

interface ExecutionTimelineProps {
  steps?: ExecutionStepRecord[];
  filePath?: string;
  onStepClick?: (line: number) => void;
}

export function ExecutionTimeline({
  steps,
  filePath,
  onStepClick,
}: ExecutionTimelineProps) {
  if (!steps?.length) {
    return null;
  }

  return (
    <section style={{ marginTop: 12 }}>
      <h4 style={{ color: "var(--muted)", fontSize: 11, margin: "0 0 8px" }}>
        Execution order (top → bottom)
      </h4>
      <ol
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
        }}
      >
        {steps.map((step) => {
          const color = STEP_COLORS[step.kind];

          return (
            <li
              key={`${step.order}-${step.line}-${step.kind}`}
              onClick={() => onStepClick?.(step.line)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  onStepClick?.(step.line);
                }
              }}
              role={onStepClick ? "button" : undefined}
              style={{
                borderLeft: `2px solid ${color}`,
                cursor: onStepClick ? "pointer" : "default",
                marginBottom: 8,
                paddingLeft: 10,
              }}
              tabIndex={onStepClick ? 0 : undefined}
            >
              <div
                style={{
                  alignItems: "center",
                  display: "flex",
                  gap: 6,
                  marginBottom: 2,
                }}
              >
                <span
                  style={{
                    background: `${color}22`,
                    borderRadius: 4,
                    color,
                    fontSize: 10,
                    fontWeight: 600,
                    padding: "1px 5px",
                  }}
                >
                  {STEP_LABELS[step.kind]}
                </span>
                <span style={{ color: "var(--muted)", fontSize: 11 }}>
                  L{step.line}
                  {filePath ? ` · ${filePath}` : ""}
                </span>
              </div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{step.label}</div>
              {step.expression ? (
                <div
                  style={{
                    color: "var(--muted)",
                    fontFamily: "var(--font-mono, monospace)",
                    fontSize: 11,
                    marginTop: 2,
                    wordBreak: "break-word",
                  }}
                >
                  {step.expression}
                </div>
              ) : null}
              {step.kind === "branch" && step.branchKind === "early_return" ? (
                <div style={{ color: "#9a6700", fontSize: 11, marginTop: 2 }}>
                  Side path — steps below run only when condition is false
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
