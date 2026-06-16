// Pure prompt assembly + output extraction — the TS mirror of Python's
// harness/. No I/O, no provider knowledge. This is where translation quality is
// tuned, so it stays side-effect-free and easy to unit test.

import type { ChatRequest } from "./types";

export interface GlossaryEntry {
  source: string;
  target: string;
  note?: string;
}

// How to talk to a class of model for translation (the "per-model assist").
// `outputOpen`/`outputClose` delimit the translation in the reply so a stray
// preamble can be stripped; leave both empty for models that reply cleanly.
export interface HarnessProfile {
  name: string;
  systemTemplate: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  outputOpen: string;
  outputClose: string;
  extraParams: Record<string, unknown>;
  reasoning?: Record<string, unknown>;
  description: string;
}

// A fully-resolved, ready-to-render request (defaults merged with overrides).
export interface TranslationSpec {
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
  instruction: string;
  model: string;
  profile: HarnessProfile;
  tone?: string;
  glossary: GlossaryEntry[];
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  reasoning?: Record<string, unknown>;
  extraParams: Record<string, unknown>;
}

function glossaryBlock(entries: GlossaryEntry[]): string {
  if (entries.length === 0) return "(none)";
  return entries
    .map((e) => `- ${e.source} → ${e.target}${e.note ? ` (${e.note})` : ""}`)
    .join("\n");
}

function toneLine(tone?: string): string {
  return tone ? `Match this tone/register: ${tone}.` : "";
}

// Replace only the known {placeholders}; leave anything else (e.g. {name} in the
// "do not translate placeholders like {name}" instruction) untouched.
function render(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (m, k: string) =>
    Object.prototype.hasOwnProperty.call(vars, k) ? vars[k] : m,
  );
}

export function renderSystemPrompt(spec: TranslationSpec): string {
  return render(spec.profile.systemTemplate, {
    instruction: spec.instruction.trim(),
    source_language: spec.sourceLanguage,
    target_language: spec.targetLanguage,
    tone_line: toneLine(spec.tone),
    glossary_block: glossaryBlock(spec.glossary),
    output_open: spec.profile.outputOpen,
    output_close: spec.profile.outputClose,
  });
}

export function buildChatRequest(spec: TranslationSpec): ChatRequest {
  const extra: Record<string, unknown> = { ...spec.extraParams };
  if (spec.reasoning) {
    // First-class reasoning wins over anything smuggled via extraParams.
    extra.reasoning = spec.reasoning;
  }
  return {
    model: spec.model,
    messages: [
      { role: "system", content: renderSystemPrompt(spec) },
      { role: "user", content: spec.text },
    ],
    sampling: {
      temperature: spec.temperature,
      topP: spec.topP,
      maxTokens: spec.maxTokens,
      extra,
    },
  };
}

export function extractTranslation(text: string, spec: TranslationSpec): string {
  const { outputOpen, outputClose } = spec.profile;
  if (outputOpen && outputClose) {
    const start = text.indexOf(outputOpen);
    if (start !== -1) {
      const from = start + outputOpen.length;
      const end = text.indexOf(outputClose, from);
      if (end !== -1) return text.slice(from, end).trim();
    }
  }
  return text.trim();
}
