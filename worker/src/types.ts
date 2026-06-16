// The boundary between translation logic and any concrete LLM backend — the TS
// mirror of the Python `providers/base.py`. Everything above this layer speaks
// only in these terms, so swapping OpenRouter for a fake (in tests) or another
// gateway is a single object substitution.
//
// Credentials are passed per call, never stored on the provider — this is what
// keeps BYOK safe.

export type Role = "system" | "user" | "assistant";

export interface ChatMessage {
  role: Role;
  content: string;
}

export interface SamplingParams {
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  stop?: string[];
  // Provider-specific passthrough (e.g. { reasoning: { effort: "low" } }).
  extra?: Record<string, unknown>;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  sampling: SamplingParams;
}

export interface Credentials {
  apiKey: string;
}

export interface Usage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface ChatResult {
  text: string;
  model: string;
  usage?: Usage;
  finishReason?: string;
}

export interface ChatProvider {
  readonly name: string;
  complete(request: ChatRequest, credentials: Credentials): Promise<ChatResult>;
  stream(
    request: ChatRequest,
    credentials: Credentials,
  ): AsyncIterable<string>;
}
