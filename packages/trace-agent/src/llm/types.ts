export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  generate(messages: LLMMessage[]): Promise<string>;
}
