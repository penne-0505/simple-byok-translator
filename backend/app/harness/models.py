"""Data shapes for the translation harness.

A :class:`HarnessProfile` is the "per-model translation assist" unit: it bundles
a system-prompt template, sampling defaults, and an output-extraction rule that
together coax a given model into producing clean, instruction-following
translations. A :class:`TranslationSpec` is one fully-resolved request — the
merge of bundled defaults and user overrides — ready to be rendered.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(slots=True, frozen=True)
class GlossaryEntry:
    source: str
    target: str
    note: str | None = None


@dataclass(slots=True, frozen=True)
class HarnessProfile:
    """How to talk to a particular class of model for translation.

    ``system_template`` is rendered with ``str.format`` against the spec fields
    ``{instruction}``, ``{source_language}``, ``{target_language}``,
    ``{tone_line}``, ``{glossary_block}``, and ``{output_open}`` /
    ``{output_close}``. Keep custom templates to those placeholders.

    ``output_open`` / ``output_close`` delimit the translation in the model's
    reply so it can be extracted even if the model adds preamble; set both to
    empty strings for models that reliably reply with the translation alone.
    """

    name: str
    system_template: str
    temperature: float | None = None
    top_p: float | None = None
    max_tokens: int | None = None
    stop: list[str] | None = None
    output_open: str = ""
    output_close: str = ""
    extra_params: dict = field(default_factory=dict)
    # Default OpenRouter `reasoning` object for this profile (e.g.
    # {"effort": "low"}); merged under any per-request override. None = unset.
    reasoning: dict | None = None
    description: str = ""


@dataclass(slots=True)
class TranslationSpec:
    """A resolved, ready-to-render translation request."""

    text: str
    source_language: str  # "auto" is allowed and passed through to the prompt
    target_language: str
    instruction: str
    model: str
    profile: HarnessProfile
    tone: str | None = None
    glossary: list[GlossaryEntry] = field(default_factory=list)
    # Effective sampling after merging profile defaults + user overrides.
    temperature: float | None = None
    top_p: float | None = None
    max_tokens: int | None = None
    reasoning: dict | None = None
    extra_params: dict = field(default_factory=dict)
