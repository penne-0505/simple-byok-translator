// Orchestrates config resolution, harness rendering, and the provider call —
// the TS mirror of translation/engine.py. Knows nothing about HTTP or OpenRouter
// specifically; composes a ConfigStore and any ChatProvider.

import type { ConfigStore } from "./config";
import { buildChatRequest, extractTranslation } from "./harness";
import type { TranslationSpec } from "./harness";
import type { TranslateRequest } from "./schemas";
import type { ChatProvider, Credentials, Usage } from "./types";

export interface TranslationOutcome {
  translation: string;
  spec: TranslationSpec;
  model: string;
  usage?: Usage;
}

export class TranslationEngine {
  constructor(
    private readonly store: ConfigStore,
    private readonly provider: ChatProvider,
  ) {}

  async translate(
    req: TranslateRequest,
    credentials: Credentials,
  ): Promise<TranslationOutcome> {
    const spec = this.store.resolve(req);
    const chatRequest = buildChatRequest(spec);
    const result = await this.provider.complete(chatRequest, credentials);
    return {
      translation: extractTranslation(result.text, spec),
      spec,
      model: result.model,
      usage: result.usage,
    };
  }

  // Streams raw output deltas. Delimiter extraction is intentionally not applied
  // (it needs the full reply); streaming resolves to a delimiter-free profile.
  async *stream(
    req: TranslateRequest,
    credentials: Credentials,
  ): AsyncIterable<string> {
    const spec = this.store.resolve(req, { stream: true });
    const chatRequest = buildChatRequest(spec);
    yield* this.provider.stream(chatRequest, credentials);
  }
}
