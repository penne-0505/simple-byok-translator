"""Prompt rendering and output extraction."""

from __future__ import annotations

from app.harness import build_chat_request, extract_translation
from app.schemas import TranslateRequest
from tests.conftest import make_store


def test_system_prompt_includes_languages_and_instruction(store):
    spec = store.resolve(
        TranslateRequest(
            text="hello", target_language="French", tone="casual", profile="general"
        )
    )
    chat = build_chat_request(spec)
    system = chat.messages[0].content
    assert chat.messages[0].role == "system"
    assert "French" in system
    assert "You are a translator." in system
    assert "casual" in system  # tone line rendered
    # The user message carries the source text verbatim.
    assert chat.messages[1].role == "user"
    assert chat.messages[1].content == "hello"


def test_glossary_rendered_into_prompt(store):
    spec = store.resolve(
        TranslateRequest(
            text="hello",
            profile="general",
            glossary=[{"source": "cat", "target": "neko", "note": "animal"}],
        )
    )
    system = build_chat_request(spec).messages[0].content
    assert "cat → neko" in system
    assert "animal" in system


def test_sampling_flows_into_request(store):
    spec = store.resolve(TranslateRequest(text="hi", temperature=0.7, max_tokens=42))
    chat = build_chat_request(spec)
    assert chat.sampling.temperature == 0.7
    assert chat.sampling.max_tokens == 42


def test_extract_with_delimiters(store):
    spec = store.resolve(TranslateRequest(text="hi", profile="general"))
    raw = "Sure!\n[[hola]] trailing"
    assert extract_translation(raw, spec) == "hola"


def test_extract_falls_back_when_delimiters_absent(store):
    spec = store.resolve(TranslateRequest(text="hi", profile="general"))
    assert extract_translation("  plain text  ", spec) == "plain text"


def test_extract_without_profile_delimiters(store):
    spec = store.resolve(TranslateRequest(text="hi", profile="gemini"))  # no delimiters
    assert extract_translation("  bonjour  ", spec) == "bonjour"


def test_reasoning_flows_into_request_extra(store):
    spec = store.resolve(TranslateRequest(text="hi", reasoning_effort="medium"))
    chat = build_chat_request(spec)
    assert chat.sampling.extra["reasoning"] == {"effort": "medium"}


def test_no_reasoning_key_when_unset(store):
    spec = store.resolve(TranslateRequest(text="hi"))
    assert "reasoning" not in build_chat_request(spec).sampling.extra


def test_user_instruction_with_braces_does_not_break_rendering(store):
    # str.format must not choke on braces inside substituted values.
    spec = store.resolve(
        TranslateRequest(text="hi", instruction="Preserve {placeholders} exactly.")
    )
    system = build_chat_request(spec).messages[0].content
    assert "{placeholders}" in system
