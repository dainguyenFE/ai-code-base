import type { SourceSnippet } from "@/lib/types";

interface SourceCodePanelProps {
  highlightLine?: number;
  source?: SourceSnippet;
}

export function SourceCodePanel({
  highlightLine,
  source,
}: SourceCodePanelProps) {
  if (!source) {
    return (
      <div style={{ color: "var(--muted)", fontSize: 13 }}>
        No source snippet for this node.
      </div>
    );
  }

  return (
    <div>
      <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 8 }}>
        {source.filePath}:{source.startLine}-{source.endLine}
      </div>
      <pre
        style={{
          background: "var(--code-bg)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          fontSize: 12,
          lineHeight: 1.5,
          margin: 0,
          maxHeight: 280,
          overflow: "auto",
          padding: 0,
        }}
      >
        <code>
          {source.code.split("\n").map((line, index) => {
            const lineNumber = source.startLine + index;
            const isHighlight = highlightLine === lineNumber;

            return (
              <div
                key={lineNumber}
                style={{
                  background: isHighlight
                    ? "rgba(9, 105, 218, 0.12)"
                    : "transparent",
                  display: "flex",
                  gap: 12,
                  padding: "0 12px",
                }}
              >
                <span
                  style={{
                    color: isHighlight ? "#0969da" : "var(--muted)",
                    flexShrink: 0,
                    minWidth: 28,
                    textAlign: "right",
                    userSelect: "none",
                  }}
                >
                  {lineNumber}
                </span>
                <span style={{ flex: 1, whiteSpace: "pre-wrap" }}>{line}</span>
              </div>
            );
          })}
        </code>
      </pre>
    </div>
  );
}
