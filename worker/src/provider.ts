// OpenRouter implementation of ChatProvider (TS mirror of providers/openrouter.py).
// Thin: marshal the neutral ChatRequest to the OpenAI-compatible wire format,
// attach the per-call bearer key, unmarshal. Uses global fetch (Workers / Node).

import { ProviderError } from "./errors";
import type {
  ChatProvider,
  ChatRequest,
  ChatResult,
  Credentials,
  Usage,
} from "./types";

interface OpenRouterOptions {
  baseUrl?: string;
  referer?: string;
  title?: string;
}

function body(request: ChatRequest, stream: boolean): Record<string, unknown> {
  const s = request.sampling;
  const out: Record<string, unknown> = {
    model: request.model,
    messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
    stream,
  };
  if (s.temperature !== undefined) out.temperature = s.temperature;
  if (s.topP !== undefined) out.top_p = s.topP;
  if (s.maxTokens !== undefined) out.max_tokens = s.maxTokens;
  if (s.stop && s.stop.length) out.stop = s.stop;
  for (const [k, v] of Object.entries(s.extra ?? {})) {
    if (!(k in out)) out[k] = v;
  }
  return out;
}

function usageFrom(raw: any): Usage | undefined {
  if (!raw) return undefined;
  return {
    promptTokens: raw.prompt_tokens,
    completionTokens: raw.completion_tokens,
    totalTokens: raw.total_tokens,
  };
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const data: any = await res.json();
    const msg = data?.error?.message ?? data?.message;
    if (msg) return String(msg);
  } catch {
    /* fall through */
  }
  return `OpenRouter returned HTTP ${res.status}`;
}

export class OpenRouterProvider implements ChatProvider {
  readonly name = "openrouter";
  private baseUrl: string;
  private appHeaders: Record<string, string> = {};

  constructor(opts: OpenRouterOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? "https://openrouter.ai/api/v1").replace(/\/$/, "");
    // HTTP-Referer / X-Title are OpenRouter attribution headers, not secrets.
    if (opts.referer) this.appHeaders["HTTP-Referer"] = opts.referer;
    if (opts.title) this.appHeaders["X-Title"] = opts.title;
  }

  private headers(credentials: Credentials): Record<string, string> {
    return {
      Authorization: `Bearer ${credentials.apiKey}`,
      "Content-Type": "application/json",
      ...this.appHeaders,
    };
  }

  async complete(request: ChatRequest, credentials: Credentials): Promise<ChatResult> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: this.headers(credentials),
        body: JSON.stringify(body(request, false)),
      });
    } catch (e) {
      throw new ProviderError(`OpenRouter request failed: ${String(e)}`);
    }
    if (!res.ok) {
      throw new ProviderError(await errorMessage(res), res.status);
    }
    const data: any = await res.json();
    const choice = data?.choices?.[0] ?? {};
    const message = choice.message ?? {};
    return {
      text: message.content ?? "",
      model: data?.model ?? request.model,
      usage: usageFrom(data?.usage),
      finishReason: choice.finish_reason,
    };
  }

  async *stream(
    request: ChatRequest,
    credentials: Credentials,
  ): AsyncIterable<string> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: this.headers(credentials),
        body: JSON.stringify(body(request, true)),
      });
    } catch (e) {
      throw new ProviderError(`OpenRouter stream failed: ${String(e)}`);
    }
    if (!res.ok) {
      throw new ProviderError(await errorMessage(res), res.status);
    }
    if (!res.body) return;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        const delta = parseSseDelta(line);
        if (delta) yield delta;
      }
    }
  }
}

function parseSseDelta(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(":")) return null;
  if (!trimmed.startsWith("data:")) return null;
  const payload = trimmed.slice("data:".length).trim();
  if (payload === "[DONE]") return null;
  try {
    const chunk: any = JSON.parse(payload);
    return chunk?.choices?.[0]?.delta?.content ?? null;
  } catch {
    return null;
  }
}
