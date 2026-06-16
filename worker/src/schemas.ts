// Wire contract (the TS mirror of Python's schemas.py). The JSON on the wire is
// snake_case to stay byte-compatible with the Python backend and the existing
// frontend; internal types (HarnessProfile, TranslationSpec) are camelCase, with
// translation happening at this boundary only. Every override is optional.

import { z } from "zod";

export const GlossaryEntrySchema = z.object({
  source: z.string(),
  target: z.string(),
  note: z.string().optional(),
});

export const TranslateRequestSchema = z.object({
  text: z.string().min(1),

  target_language: z.string().optional(),
  source_language: z.string().optional(),
  model: z.string().optional(),
  profile: z.string().optional(),

  instruction: z.string().optional(),
  instruction_mode: z.enum(["append", "replace"]).default("append"),
  tone: z.string().optional(),
  glossary: z.array(GlossaryEntrySchema).default([]),

  temperature: z.number().optional(),
  top_p: z.number().optional(),
  max_tokens: z.number().int().optional(),

  reasoning_effort: z.string().optional(),
  reasoning: z.record(z.string(), z.unknown()).optional(),

  extra_params: z.record(z.string(), z.unknown()).default({}),
});

export type TranslateRequest = z.infer<typeof TranslateRequestSchema>;

export interface UsageModel {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface TranslateResponse {
  translation: string;
  model: string;
  profile: string;
  source_language: string;
  target_language: string;
  usage?: UsageModel;
}

export interface ProfileInfo {
  name: string;
  description: string;
}

export interface PublicConfig {
  default_model: string;
  default_source_language: string;
  default_target_language: string;
  base_instruction: string;
  default_profile: string;
  profiles: ProfileInfo[];
  model_profile_map: Record<string, string>;
  known_models: string[];
  reasoning_efforts: string[];
}

export interface ErrorResponse {
  code: string;
  message: string;
  details: Record<string, unknown>;
}
