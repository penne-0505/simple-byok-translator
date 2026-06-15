"""Resolution layering: defaults, profile selection, instruction merge."""

from __future__ import annotations

import pytest

from app.errors import ConfigError, InvalidRequestError
from app.schemas import TranslateRequest
from tests.conftest import make_store


def test_defaults_applied_when_request_is_bare(store):
    spec = store.resolve(TranslateRequest(text="hello"))
    assert spec.model == "google/gemini-2.5-flash"
    assert spec.target_language == "Spanish"
    assert spec.source_language == "auto"
    assert spec.instruction == "You are a translator."
    # google/* maps to the gemini profile.
    assert spec.profile.name == "gemini"
    assert spec.temperature == 0.4  # from the gemini profile


def test_model_override_selects_mapped_profile(store):
    spec = store.resolve(
        TranslateRequest(text="hi", model="anthropic/claude-sonnet-4")
    )
    assert spec.profile.name == "claude"
    assert spec.temperature == 0.2


def test_explicit_profile_beats_model_mapping(store):
    spec = store.resolve(
        TranslateRequest(text="hi", model="anthropic/claude-sonnet-4", profile="general")
    )
    assert spec.profile.name == "general"


def test_unmapped_model_falls_back_to_default_profile(store):
    spec = store.resolve(TranslateRequest(text="hi", model="meta/llama-3"))
    assert spec.profile.name == "general"


def test_instruction_append_mode(store):
    spec = store.resolve(
        TranslateRequest(text="hi", instruction="Keep it formal.")
    )
    assert spec.instruction == "You are a translator.\n\nKeep it formal."


def test_instruction_replace_mode(store):
    spec = store.resolve(
        TranslateRequest(
            text="hi", instruction="Only slang.", instruction_mode="replace"
        )
    )
    assert spec.instruction == "Only slang."


def test_invalid_instruction_mode_raises(store):
    with pytest.raises(InvalidRequestError):
        store.resolve(
            TranslateRequest(text="hi", instruction="x", instruction_mode="prepend")
        )


def test_sampling_override_beats_profile(store):
    spec = store.resolve(TranslateRequest(text="hi", temperature=0.9, max_tokens=512))
    assert spec.temperature == 0.9
    assert spec.max_tokens == 512


def test_unknown_profile_raises(store):
    with pytest.raises(InvalidRequestError):
        store.resolve(TranslateRequest(text="hi", profile="does-not-exist"))


def test_extra_params_merge_profile_then_request(store):
    s = make_store(
        profiles={
            "general": {
                "system_template": "{instruction}",
                "extra_params": {"provider": {"order": ["a"]}, "keep": 1},
            },
        },
        default_profile="general",
        default_stream_profile="general",
        model_profile_map={},
    )
    spec = s.resolve(TranslateRequest(text="hi", extra_params={"provider": {"order": ["b"]}}))
    assert spec.extra_params["keep"] == 1
    assert spec.extra_params["provider"] == {"order": ["b"]}  # request wins


def test_bad_default_profile_rejected_at_construction():
    with pytest.raises(ConfigError):
        make_store(default_profile="nope")


def test_reasoning_none_when_unset(store):
    assert store.resolve(TranslateRequest(text="hi")).reasoning is None


def test_reasoning_effort_resolves(store):
    spec = store.resolve(TranslateRequest(text="hi", reasoning_effort="high"))
    assert spec.reasoning == {"effort": "high"}


def test_reasoning_object_and_effort_merge(store):
    spec = store.resolve(
        TranslateRequest(text="hi", reasoning={"max_tokens": 500}, reasoning_effort="low")
    )
    assert spec.reasoning == {"max_tokens": 500, "effort": "low"}


def test_invalid_reasoning_effort_raises(store):
    with pytest.raises(InvalidRequestError):
        store.resolve(TranslateRequest(text="hi", reasoning_effort="ultra"))


def test_profile_reasoning_default_and_request_override():
    s = make_store(
        profiles={
            "general": {
                "system_template": "{instruction}",
                "reasoning": {"effort": "low"},
            },
        },
        default_profile="general",
        default_stream_profile="general",
        model_profile_map={},
    )
    assert s.resolve(TranslateRequest(text="hi")).reasoning == {"effort": "low"}
    assert s.resolve(
        TranslateRequest(text="hi", reasoning_effort="high")
    ).reasoning == {"effort": "high"}


def test_real_config_loads_and_resolves(real_store):
    spec = real_store.resolve(TranslateRequest(text="hi"))
    assert spec.model
    assert spec.profile.system_template
    public = real_store.public_config()
    assert public.default_model == spec.model
    assert any(p.name == "general" for p in public.profiles)
