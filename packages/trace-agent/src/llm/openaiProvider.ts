import type { AiConfig } from "@ai-trace/types";

import type { LLMMessage, LLMProvider } from "./types.js";

interface OpenAIChatResponse {
  choices?: {
    message?: {
      content?: string;
    };
  }[];
  error?: {
    message?: string;
  };
}

export class OpenAIProvider implements LLMProvider {
  readonly name = "openai";
  readonly model: string;

  constructor(
    private readonly apiKey: string,
    config: AiConfig
  ) {
    this.model = config.model;
  }

  async generate(messages: LLMMessage[]): Promise<string> {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      body: JSON.stringify({
        messages,
        model: this.model,
        temperature: 0.1,
      }),
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    const payload = (await response.json()) as OpenAIChatResponse;

    if (!response.ok) {
      throw new Error(
        payload.error?.message ??
          `OpenAI request failed with status ${response.status}`
      );
    }

    const content = payload.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error("OpenAI returned an empty response.");
    }

    return content;
  }
}
