"""Pure functions that render a :class:`TranslationSpec` into a ChatRequest.

No I/O, no provider knowledge — just prompt assembly and output extraction.
This is the most likely place to iterate on translation quality, so it is kept
free of side effects and easy to unit test.
"""

from __future__ import annotations

import re

from app.harness.models import GlossaryEntry, TranslationSpec
from app.providers.base import ChatMessage, ChatRequest, SamplingParams


def _glossary_block(entries: list[GlossaryEntry]) -> str:
    if not entries:
        return "(none)"
    lines = []
    for e in entries:
        line = f"- {e.source} → {e.target}"
        if e.note:
            line += f" ({e.note})"
        lines.append(line)
    return "\n".join(lines)


def _tone_line(tone: str | None) -> str:
    if not tone:
        return ""
    return f"Match this tone/register: {tone}."


def render_system_prompt(spec: TranslationSpec) -> str:
    return spec.profile.system_template.format(
        instruction=spec.instruction.strip(),
        source_language=spec.source_language,
        target_language=spec.target_language,
        tone_line=_tone_line(spec.tone),
        glossary_block=_glossary_block(spec.glossary),
        output_open=spec.profile.output_open,
        output_close=spec.profile.output_close,
    )


def build_chat_request(spec: TranslationSpec) -> ChatRequest:
    system = render_system_prompt(spec)
    messages = [
        ChatMessage(role="system", content=system),
        ChatMessage(role="user", content=spec.text),
    ]
    extra = dict(spec.extra_params)
    if spec.reasoning:
        # First-class reasoning wins over any reasoning smuggled via extra_params.
        extra["reasoning"] = spec.reasoning
    sampling = SamplingParams(
        temperature=spec.temperature,
        top_p=spec.top_p,
        max_tokens=spec.max_tokens,
        extra=extra,
    )
    return ChatRequest(model=spec.model, messages=messages, sampling=sampling)


def extract_translation(text: str, spec: TranslationSpec) -> str:
    """Pull the translation out of the model's reply.

    If the profile uses delimiters and they are present, return what is between
    them; otherwise fall back to the trimmed full reply. This keeps a stray
    "Sure, here is the translation:" preamble from leaking into output while
    still degrading gracefully when the model ignores the delimiters.
    """
    open_tag = spec.profile.output_open
    close_tag = spec.profile.output_close
    if open_tag and close_tag:
        pattern = re.escape(open_tag) + r"(.*?)" + re.escape(close_tag)
        match = re.search(pattern, text, re.DOTALL)
        if match:
            return match.group(1).strip()
    return text.strip()
