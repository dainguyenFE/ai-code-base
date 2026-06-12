import type { AiConfig } from "@ai-trace/types";

import { OllamaProvider } from "./ollamaProvider.js";
import { OpenAIProvider } from "./openaiProvider.js";
import type { LLMProvider } from "./types.js";

export function createLLMProvider(config: AiConfig): LLMProvider {
  if (config.provider === "openai") {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        'OPENAI_API_KEY is required for provider "openai". Add it to .env.local.'
      );
    }
    return new OpenAIProvider(apiKey, config);
  }

  return new OllamaProvider(config);
}

export function resolveAiConfig(
  configAi: AiConfig | undefined,
  useAi: boolean
): AiConfig {
  const defaults: AiConfig = {
    baseUrl: "http://localhost:11434",
    enabled: false,
    maxContextFiles: 8,
    maxGraphDepth: 2,
    model: "qwen2.5-coder:7b",
    provider: "ollama",
    saveTraceResult: true,
    temperature: 0.1,
  };

  const merged = { ...defaults, ...configAi };

  if (useAi) {
    merged.enabled = true;
  }

  if (!merged.enabled) {
    throw new Error(
      'AI trace is disabled. Pass --ai or set "ai.enabled": true in .ai-trace/config.json.'
    );
  }

  return merged;
}
