"""Engine orchestration against a fake provider."""

from __future__ import annotations

import pytest

from app.providers.base import Credentials, Usage
from app.schemas import TranslateRequest
from app.translation import TranslationEngine
from tests.conftest import FakeProvider


async def test_translate_extracts_and_threads_credentials(store):
    provider = FakeProvider(reply="noise [[hola]] noise", usage=Usage(total_tokens=5))
    engine = TranslationEngine(store, provider)

    outcome = await engine.translate(
        TranslateRequest(text="hello", profile="general"),
        Credentials(api_key="sk-or-test"),
    )

    assert outcome.translation == "hola"
    assert outcome.usage.total_tokens == 5
    # The provider saw the user's key and the resolved model.
    request, creds = provider.calls[0]
    assert creds.api_key == "sk-or-test"
    assert request.model == "google/gemini-2.5-flash"


async def test_translate_uses_resolved_profile_temperature(store):
    provider = FakeProvider(reply="<t>hej</t>")
    engine = TranslationEngine(store, provider)

    outcome = await engine.translate(
        TranslateRequest(text="hi", model="anthropic/claude-sonnet-4"),
        Credentials(api_key="k"),
    )

    assert outcome.translation == "hej"
    request, _ = provider.calls[0]
    assert request.sampling.temperature == 0.2  # claude profile


async def test_stream_yields_raw_deltas(store):
    provider = FakeProvider(deltas=["ho", "la"])
    engine = TranslationEngine(store, provider)

    chunks = [
        c
        async for c in engine.stream(
            TranslateRequest(text="hi"), Credentials(api_key="k")
        )
    ]
    assert chunks == ["ho", "la"]


async def test_stream_defaults_to_delimiter_free_profile(store):
    # Default streaming must avoid the delimiter profiles (whose tags would
    # leak into deltas, since streaming can't post-extract).
    provider = FakeProvider(deltas=["x"])
    engine = TranslationEngine(store, provider)

    async for _ in engine.stream(
        TranslateRequest(text="hi", model="google/gemini-2.5-flash"),
        Credentials(api_key="k"),
    ):
        pass

    request = provider.calls[0][0]
    # The raw profile has no output delimiters in its rendered system prompt.
    assert "<<<" not in request.messages[0].content


async def test_stream_honors_explicit_profile(store):
    provider = FakeProvider(deltas=["x"])
    engine = TranslationEngine(store, provider)

    async for _ in engine.stream(
        TranslateRequest(text="hi", profile="general"), Credentials(api_key="k")
    ):
        pass

    request = provider.calls[0][0]
    assert "[[" in request.messages[0].content  # general profile delimiters present


async def test_provider_error_propagates(store):
    from app.errors import ProviderError

    provider = FakeProvider(error=ProviderError("boom", upstream_status=429))
    engine = TranslationEngine(store, provider)

    with pytest.raises(ProviderError) as exc:
        await engine.translate(TranslateRequest(text="hi"), Credentials(api_key="k"))
    assert exc.value.status_code == 429
