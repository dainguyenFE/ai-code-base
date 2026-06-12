import type { AiTraceResult } from "@ai-trace/types";
import { z } from "zod";

export const AiTraceResultSchema = z.object({
  entryPoints: z.array(
    z.object({
      file: z.string(),
      lines: z.string().optional(),
    })
  ),
  flow: z.array(
    z.object({
      detail: z.string(),
      file: z.string().optional(),
      step: z.number(),
      title: z.string(),
    })
  ),
  relatedFiles: z.array(z.string()),
  summary: z.string(),
  title: z.string(),
  warnings: z.array(z.string()),
});

export function parseAiTraceAnswer(
  rawAnswer: string,
  fallbackTitle: string
): AiTraceResult {
  const jsonText = extractJsonObject(rawAnswer);

  try {
    const parsed = AiTraceResultSchema.parse(JSON.parse(jsonText));
    return {
      ...parsed,
      createdAt: new Date().toISOString(),
      rawAnswer,
    };
  } catch {
    return {
      createdAt: new Date().toISOString(),
      entryPoints: [],
      flow: [
        {
          detail: rawAnswer,
          step: 1,
          title: "AI response",
        },
      ],
      rawAnswer,
      relatedFiles: [],
      summary: "AI response could not be parsed as structured JSON.",
      title: fallbackTitle,
      warnings: ["Response was not valid JSON. Showing raw answer in flow."],
    };
  }
}

function extractJsonObject(text: string): string {
  const trimmed = text.trim();

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    return trimmed.slice(start, end + 1);
  }

  return trimmed;
}
