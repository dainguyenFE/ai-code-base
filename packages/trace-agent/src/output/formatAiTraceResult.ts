import type { AiTraceResult } from "@ai-trace/types";

export function formatAiTraceMarkdown(result: AiTraceResult): string {
  const entryPoints =
    result.entryPoints.length > 0
      ? result.entryPoints
          .map((entry) =>
            entry.lines ? `- ${entry.file}:${entry.lines}` : `- ${entry.file}`
          )
          .join("\n")
      : "- none";

  const flow = result.flow
    .map((step) => {
      const fileLine = step.file ? `\n   File: ${step.file}` : "";
      return `${step.step}. ${step.title}${fileLine}\n   Detail: ${step.detail}`;
    })
    .join("\n\n");

  const relatedFiles =
    result.relatedFiles.length > 0
      ? result.relatedFiles.map((file) => `- ${file}`).join("\n")
      : "- none";

  const warnings =
    result.warnings.length > 0
      ? result.warnings.map((warning) => `- ${warning}`).join("\n")
      : "None.";

  return `# Trace: ${result.title}

## Summary

${result.summary}

## Entry Points

${entryPoints}

## Flow

${flow}

## Related Files

${relatedFiles}

## Warnings

${warnings}
`;
}
