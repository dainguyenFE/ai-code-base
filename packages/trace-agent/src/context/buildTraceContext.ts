import type { RetrievedContext } from "@ai-trace/types";

function formatSymbol(symbol: RetrievedContext["symbols"][number]): string {
  return [
    `- ${symbol.name}`,
    `  - id: ${symbol.id}`,
    `  - type: ${symbol.type}`,
    `  - file: ${symbol.filePath}`,
    `  - lines: ${symbol.startLine}-${symbol.endLine}`,
    `  - props: ${symbol.props?.join(", ") || "none"}`,
    `  - renders: ${symbol.renders?.join(", ") || "none"}`,
    `  - hooks: ${symbol.usesHooks?.join(", ") || "none"}`,
    `  - calls: ${symbol.calls?.join(", ") || "none"}`,
  ].join("\n");
}

export function buildTraceContext(ctx: RetrievedContext): string {
  const symbols = ctx.symbols.map(formatSymbol).join("\n");
  const edges = ctx.edges
    .map((edge) => `- ${edge.from} --${edge.type}--> ${edge.to}`)
    .join("\n");
  const snippets = ctx.files
    .map(
      (file) =>
        `### ${file.path}:${file.startLine}-${file.endLine}\n\n\`\`\`tsx\n${file.code}\n\`\`\``
    )
    .join("\n\n");
  const warnings =
    ctx.warnings.length > 0
      ? ctx.warnings.map((warning) => `- ${warning}`).join("\n")
      : "- none";

  return `# Code Trace Context

## Intent

${ctx.intent}

## Target

${ctx.targetName ?? "unknown"}

## Symbols

${symbols || "- none"}

## Graph Edges

${edges || "- none"}

## Source Snippets

${snippets || "- none"}

## Warnings

${warnings}
`;
}

export function buildTracePrompt(
  ctx: RetrievedContext,
  userQuery: string
): string {
  const context = buildTraceContext(ctx);

  return `User query:
${userQuery}

Use only the context below. Return valid JSON with this shape:
{
  "title": string,
  "summary": string,
  "entryPoints": [{ "file": string, "lines": string | optional }],
  "flow": [{ "step": number, "title": string, "file": string | optional, "detail": string }],
  "relatedFiles": string[],
  "warnings": string[]
}

Requirements:
1. Summary of what the target does
2. Entry files with line ranges when known
3. Step-by-step flow based on graph edges and snippets
4. Related files from context only
5. Warnings for missing or uncertain data

${context}`;
}
