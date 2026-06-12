import type { TraceDatabase } from "@ai-trace/cache";
import type { AiConfig, AiTraceResult, TraceIntent } from "@ai-trace/types";

import { buildTracePrompt } from "./context/buildTraceContext.js";
import { createLLMProvider } from "./llm/createProvider.js";
import { TRACE_SYSTEM_PROMPT } from "./llm/systemPrompt.js";
import { parseAiTraceAnswer } from "./output/aiTraceResultSchema.js";
import { formatAiTraceMarkdown } from "./output/formatAiTraceResult.js";
import { retrieveContext } from "./retriever/retrieveContext.js";

export interface RunAiTraceOptions {
  db: TraceDatabase;
  rootDir: string;
  intent: TraceIntent;
  targetName: string;
  userQuery: string;
  aiConfig: AiConfig;
}

export interface AiTraceOutput {
  markdown: string;
  result: AiTraceResult;
}

export async function runAiTrace(
  options: RunAiTraceOptions
): Promise<AiTraceOutput> {
  const retrieved = await retrieveContext(options.db, {
    intent: options.intent,
    maxContextFiles: options.aiConfig.maxContextFiles,
    maxGraphDepth: options.aiConfig.maxGraphDepth,
    rootDir: options.rootDir,
    targetName: options.targetName,
  });

  if (retrieved.symbols.length === 0 && retrieved.warnings.length > 0) {
    const fallback: AiTraceResult = {
      createdAt: new Date().toISOString(),
      entryPoints: [],
      flow: [],
      model: options.aiConfig.model,
      provider: options.aiConfig.provider,
      relatedFiles: [],
      summary: retrieved.warnings.join(" "),
      title: `Trace ${options.targetName}`,
      warnings: retrieved.warnings,
    };

    return {
      markdown: formatAiTraceMarkdown(fallback),
      result: fallback,
    };
  }

  const provider = createLLMProvider(options.aiConfig);
  const prompt = buildTracePrompt(retrieved, options.userQuery);
  const rawAnswer = await provider.generate([
    { content: TRACE_SYSTEM_PROMPT, role: "system" },
    { content: prompt, role: "user" },
  ]);

  const parsed = parseAiTraceAnswer(rawAnswer, `Trace ${options.targetName}`);
  parsed.provider = provider.name;
  parsed.model = provider.model;
  parsed.warnings = [...retrieved.warnings, ...parsed.warnings];

  if (parsed.relatedFiles.length === 0) {
    parsed.relatedFiles = [
      ...new Set(retrieved.symbols.map((symbol) => symbol.filePath)),
    ];
  }

  return {
    markdown: formatAiTraceMarkdown(parsed),
    result: parsed,
  };
}
