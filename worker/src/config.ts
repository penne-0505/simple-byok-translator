// Bundled defaults + per-request override resolution — the TS mirror of Python's
// config_store.py and config/defaults.yaml. On Workers everything is bundled at
// deploy, so the defaults live here as a typed module rather than external YAML.
//
// Resolution precedence: bundled default < model→profile map < explicit override.

import { ConfigError, InvalidRequestError } from "./errors";
import type { GlossaryEntry, HarnessProfile, TranslationSpec } from "./harness";
import type { PublicConfig, TranslateRequest } from "./schemas";

export const ALLOWED_REASONING_EFFORTS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

interface RawProfile {
  systemTemplate: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  outputOpen?: string;
  outputClose?: string;
  extraParams?: Record<string, unknown>;
  reasoning?: Record<string, unknown>;
  description?: string;
}

export interface RawConfig {
  defaultModel: string;
  defaultSourceLanguage: string;
  defaultTargetLanguage: string;
  defaultProfile: string;
  defaultStreamProfile: string;
  modelProfileMap: Record<string, string>;
  knownModels: string[];
  baseInstruction: string;
  profiles: Record<string, RawProfile>;
}

const GENERAL_TEMPLATE = `{instruction}

Translate the text the user provides from {source_language} to {target_language}.

Rules:
- Output only the translation. No explanations, notes, or apologies.
- Preserve formatting, line breaks, markdown, and code exactly.
- Do not translate content inside code blocks, URLs, or placeholders like {name}.
- {tone_line}

Glossary (apply when relevant):
{glossary_block}

Put the entire translation between {output_open} and {output_close}, with nothing outside them.`;

const CLAUDE_TEMPLATE = `{instruction}

Translate the user's text from {source_language} to {target_language}.

Constraints:
- Reply with the translation only — no preamble, no commentary.
- Keep all formatting, markdown, line breaks, and code verbatim.
- Leave code blocks, URLs, and placeholders like {name} untranslated.
- {tone_line}

Glossary to honor when applicable:
{glossary_block}

Wrap the full translation in {output_open}...{output_close} tags and write nothing outside them.`;

const GEMINI_TEMPLATE = `{instruction}

Task: translate from {source_language} to {target_language}.

Requirements:
- Return only the translated text.
- Preserve every line break, markdown token, and code span exactly.
- Never translate code blocks, URLs, or {name}-style placeholders.
- {tone_line}

Glossary:
{glossary_block}

Emit the translation between {output_open} and {output_close} and nothing else.`;

const RAW_TEMPLATE = `{instruction}

Translate the user's text from {source_language} to {target_language}.
Output only the translation, preserving all formatting and leaving code,
URLs, and {name}-style placeholders untranslated. {tone_line}

Glossary to apply when relevant:
{glossary_block}`;

// Verified live on OpenRouter 2026-06-15; slugs drift, so treat as a starting menu.
export const DEFAULT_CONFIG: RawConfig = {
  defaultModel: "google/gemini-3.1-flash-lite",
  defaultSourceLanguage: "auto",
  defaultTargetLanguage: "Japanese",
  defaultProfile: "general",
  defaultStreamProfile: "raw",
  modelProfileMap: {
    "anthropic/*": "claude",
    "google/*": "gemini",
    "openai/*": "general",
  },
  knownModels: [
    "google/gemini-3.1-flash-lite",
    "google/gemini-3.5-flash",
    "google/gemini-3.1-pro-preview",
    "google/gemini-2.5-flash",
    "anthropic/claude-haiku-4.5",
    "anthropic/claude-opus-4.5",
    "openai/gpt-4o-mini",
    "deepseek/deepseek-chat",
  ],
  baseInstruction:
    "You are a professional translator. Produce an accurate, natural translation " +
    "that reads as if originally written by a native speaker of the target " +
    "language. Preserve the author's meaning, register, and intent. Do not add, " +
    "omit, or editorialize.",
  profiles: {
    general: {
      description: "Model-agnostic default. Delimited output, balanced temperature.",
      temperature: 0.3,
      outputOpen: "<<<TRANSLATION>>>",
      outputClose: "<<<END>>>",
      systemTemplate: GENERAL_TEMPLATE,
    },
    claude: {
      description: "Anthropic models. XML delimiters, low temperature for fidelity.",
      temperature: 0.2,
      outputOpen: "<translation>",
      outputClose: "</translation>",
      systemTemplate: CLAUDE_TEMPLATE,
    },
    gemini: {
      description: "Google Gemini models. Delimited output, balanced temperature.",
      temperature: 0.3,
      outputOpen: "<<<TRANSLATION>>>",
      outputClose: "<<<END>>>",
      systemTemplate: GEMINI_TEMPLATE,
    },
    raw: {
      description: "No delimiters. Best for streaming or models that reply cleanly.",
      temperature: 0.3,
      systemTemplate: RAW_TEMPLATE,
    },
  },
};

function globMatch(value: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(value);
}

function first<T>(...values: (T | undefined)[]): T | undefined {
  for (const v of values) if (v !== undefined) return v;
  return undefined;
}

export class ConfigStore {
  private profiles: Map<string, HarnessProfile>;
  readonly defaultModel: string;
  readonly defaultSourceLanguage: string;
  readonly defaultTargetLanguage: string;
  readonly defaultProfile: string;
  readonly defaultStreamProfile: string;
  readonly modelProfileMap: Record<string, string>;
  readonly knownModels: string[];
  readonly baseInstruction: string;

  constructor(raw: RawConfig = DEFAULT_CONFIG) {
    this.defaultModel = raw.defaultModel;
    this.defaultSourceLanguage = raw.defaultSourceLanguage;
    this.defaultTargetLanguage = raw.defaultTargetLanguage;
    this.defaultProfile = raw.defaultProfile;
    this.defaultStreamProfile = raw.defaultStreamProfile;
    this.modelProfileMap = raw.modelProfileMap;
    this.knownModels = raw.knownModels;
    this.baseInstruction = raw.baseInstruction.trim();

    this.profiles = new Map();
    for (const [name, p] of Object.entries(raw.profiles)) {
      this.profiles.set(name, {
        name,
        systemTemplate: p.systemTemplate,
        temperature: p.temperature,
        topP: p.topP,
        maxTokens: p.maxTokens,
        outputOpen: p.outputOpen ?? "",
        outputClose: p.outputClose ?? "",
        extraParams: p.extraParams ?? {},
        reasoning: p.reasoning,
        description: p.description ?? "",
      });
    }
    if (!this.profiles.has(this.defaultProfile)) {
      throw new ConfigError(`default_profile '${this.defaultProfile}' is not defined`);
    }
    if (!this.profiles.has(this.defaultStreamProfile)) {
      throw new ConfigError(
        `default_stream_profile '${this.defaultStreamProfile}' is not defined`,
      );
    }
    for (const [glob, profileName] of Object.entries(this.modelProfileMap)) {
      if (!this.profiles.has(profileName)) {
        throw new ConfigError(
          `model_profile_map['${glob}'] points to unknown profile '${profileName}'`,
        );
      }
    }
  }

  profileForModel(model: string): HarnessProfile {
    for (const [glob, profileName] of Object.entries(this.modelProfileMap)) {
      if (globMatch(model, glob)) return this.profiles.get(profileName)!;
    }
    return this.profiles.get(this.defaultProfile)!;
  }

  getProfile(name: string): HarnessProfile {
    const p = this.profiles.get(name);
    if (!p) {
      throw new InvalidRequestError(`unknown profile '${name}'`, {
        available: [...this.profiles.keys()].sort(),
      });
    }
    return p;
  }

  resolve(req: TranslateRequest, opts: { stream?: boolean } = {}): TranslationSpec {
    const model = req.model ?? this.defaultModel;

    let profile: HarnessProfile;
    if (req.profile != null) {
      profile = this.getProfile(req.profile);
    } else if (opts.stream) {
      profile = this.profiles.get(this.defaultStreamProfile)!;
    } else {
      profile = this.profileForModel(model);
    }

    const glossary: GlossaryEntry[] = req.glossary.map((g) => ({
      source: g.source,
      target: g.target,
      note: g.note,
    }));

    return {
      text: req.text,
      sourceLanguage: req.source_language ?? this.defaultSourceLanguage,
      targetLanguage: req.target_language ?? this.defaultTargetLanguage,
      instruction: this.resolveInstruction(req),
      model,
      profile,
      tone: req.tone,
      glossary,
      temperature: first(req.temperature, profile.temperature),
      topP: first(req.top_p, profile.topP),
      maxTokens: first(req.max_tokens, profile.maxTokens),
      reasoning: this.resolveReasoning(req, profile),
      extraParams: { ...profile.extraParams, ...req.extra_params },
    };
  }

  private resolveInstruction(req: TranslateRequest): string {
    if (req.instruction == null) return this.baseInstruction;
    if (req.instruction_mode === "replace") return req.instruction.trim();
    return `${this.baseInstruction}\n\n${req.instruction.trim()}`.trim();
  }

  private resolveReasoning(
    req: TranslateRequest,
    profile: HarnessProfile,
  ): Record<string, unknown> | undefined {
    const merged: Record<string, unknown> = { ...(profile.reasoning ?? {}) };
    if (req.reasoning) Object.assign(merged, req.reasoning);
    if (req.reasoning_effort != null) merged.effort = req.reasoning_effort;
    if (Object.keys(merged).length === 0) return undefined;
    const effort = merged.effort;
    if (
      effort !== undefined &&
      !ALLOWED_REASONING_EFFORTS.includes(effort as (typeof ALLOWED_REASONING_EFFORTS)[number])
    ) {
      throw new InvalidRequestError(
        `reasoning effort must be one of ${JSON.stringify(ALLOWED_REASONING_EFFORTS)}, got '${String(effort)}'`,
      );
    }
    return merged;
  }

  publicConfig(): PublicConfig {
    return {
      default_model: this.defaultModel,
      default_source_language: this.defaultSourceLanguage,
      default_target_language: this.defaultTargetLanguage,
      base_instruction: this.baseInstruction,
      default_profile: this.defaultProfile,
      profiles: [...this.profiles.values()].map((p) => ({
        name: p.name,
        description: p.description,
      })),
      model_profile_map: this.modelProfileMap,
      known_models: this.knownModels,
      reasoning_efforts: [...ALLOWED_REASONING_EFFORTS],
    };
  }
}
