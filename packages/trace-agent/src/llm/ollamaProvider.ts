import type { AiConfig } from "@ai-trace/types";

import type { LLMMessage, LLMProvider } from "./types.js";

interface OllamaChatResponse {
  message?: {
    content?: string;
  };
  error?: string;
}

export class OllamaProvider implements LLMProvider {
  readonly name = "ollama";
  readonly model: string;
  private readonly baseUrl: string;
  private readonly temperature: number;

  constructor(config: AiConfig) {
    this.model = config.model;
    this.baseUrl = config.baseUrl ?? "http://localhost:11434";
    this.temperature = config.temperature;
  }

  async generate(messages: LLMMessage[]): Promise<string> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      body: JSON.stringify({
        messages,
        model: this.model,
        options: {
          temperature: this.temperature,
        },
        stream: false,
      }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    const payload = (await response.json()) as OllamaChatResponse;

    if (!response.ok) {
      throw new Error(
        payload.error ?? `Ollama request failed with status ${response.status}`
      );
    }

    const content = payload.message?.content?.trim();
    if (!content) {
      throw new Error("Ollama returned an empty response.");
    }

    return content;
  }
}
