// Shared test fixtures: a fake provider and a small deterministic store.
// Tests never hit the network; the fake records what it was called with.

import { ConfigStore, type RawConfig } from "../src/config";
import { TranslateRequestSchema, type TranslateRequest } from "../src/schemas";
import type {
  ChatProvider,
  ChatRequest,
  ChatResult,
  Credentials,
  Usage,
} from "../src/types";

export class FakeProvider implements ChatProvider {
  readonly name = "fake";
  calls: { request: ChatRequest; credentials: Credentials }[] = [];

  constructor(
    private opts: {
      reply?: string;
      usage?: Usage;
      error?: Error;
      deltas?: string[];
    } = {},
  ) {}

  async complete(request: ChatRequest, credentials: Credentials): Promise<ChatResult> {
    this.calls.push({ request, credentials });
    if (this.opts.error) throw this.opts.error;
    return {
      text: this.opts.reply ?? "hola mundo",
      model: request.model,
      usage: this.opts.usage,
    };
  }

  async *stream(
    request: ChatRequest,
    credentials: Credentials,
  ): AsyncIterable<string> {
    this.calls.push({ request, credentials });
    if (this.opts.error) throw this.opts.error;
    for (const d of this.opts.deltas ?? [this.opts.reply ?? "hola mundo"]) {
      yield d;
    }
  }
}

const BASE: RawConfig = {
  defaultModel: "google/gemini-2.5-flash",
  defaultSourceLanguage: "auto",
  defaultTargetLanguage: "Spanish",
  defaultProfile: "general",
  defaultStreamProfile: "raw",
  modelProfileMap: { "anthropic/*": "claude", "google/*": "gemini" },
  knownModels: ["google/gemini-2.5-flash", "anthropic/claude-haiku-4.5"],
  baseInstruction: "You are a translator.",
  profiles: {
    general: {
      description: "default",
      temperature: 0.3,
      outputOpen: "[[",
      outputClose: "]]",
      systemTemplate:
        "{instruction}\nFrom {source_language} to {target_language}. {tone_line}\n" +
        "Glossary:\n{glossary_block}\nWrap in {output_open}{output_close}.",
    },
    claude: {
      description: "anthropic",
      temperature: 0.2,
      outputOpen: "<t>",
      outputClose: "</t>",
      systemTemplate:
        "{instruction}\n{source_language}->{target_language} {tone_line} " +
        "{glossary_block} {output_open}{output_close}",
    },
    gemini: {
      description: "google",
      temperature: 0.4,
      systemTemplate: "{instruction} {source_language} {target_language}",
    },
    raw: {
      description: "no delimiters",
      temperature: 0.3,
      systemTemplate: "{instruction} {source_language}->{target_language}",
    },
  },
};

export function makeStore(overrides: Partial<RawConfig> = {}): ConfigStore {
  return new ConfigStore({ ...BASE, ...overrides });
}

/** Minimal in-memory KVNamespace stand-in for tests (get/put only). */
export class FakeKV {
  store = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
}

// Build a fully-defaulted TranslateRequest the way the route does (via the schema).
export function req(obj: Record<string, unknown>): TranslateRequest {
  return TranslateRequestSchema.parse(obj);
}
