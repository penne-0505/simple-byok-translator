"""HTTP surface: routes, BYOK credential extraction, error mapping."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.errors import ProviderError
from app.main import app, get_engine
from app.providers.base import Usage
from app.translation import TranslationEngine
from tests.conftest import FakeProvider, make_store


def build_client(provider: FakeProvider) -> TestClient:
    engine = TranslationEngine(make_store(), provider)
    client = TestClient(app)
    app.dependency_overrides[get_engine] = lambda: engine
    # Ensure no ambient dev key (env or keyring) leaks into credential tests.
    with client:
        client.app.state.dev_api_key = None
    return client


@pytest.fixture
def provider() -> FakeProvider:
    return FakeProvider(reply="hola [[hola mundo]]")


@pytest.fixture
def client(provider):
    c = build_client(provider)
    yield c
    app.dependency_overrides.clear()


def test_healthz(client):
    r = client.get("/healthz")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_config_is_public_and_secret_free(client):
    r = client.get("/v1/config")
    assert r.status_code == 200
    body = r.json()
    assert body["default_model"] == "google/gemini-2.5-flash"
    assert "general" in {p["name"] for p in body["profiles"]}
    # No secret-ish keys leak.
    assert "api_key" not in str(body).lower()


def test_translate_happy_path(client, provider):
    r = client.post(
        "/v1/translate",
        json={"text": "hello", "profile": "general", "target_language": "Spanish"},
        headers={"Authorization": "Bearer sk-or-user-key"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["translation"] == "hola mundo"
    assert body["target_language"] == "Spanish"
    # The user's BYOK key reached the provider unchanged.
    _, creds = provider.calls[0]
    assert creds.api_key == "sk-or-user-key"


def test_translate_serializes_usage():
    # Regression: Usage is a slotted dataclass, so the response path must use
    # dataclasses.asdict, not vars(), when the provider returns token usage.
    provider = FakeProvider(
        reply="[[hola]]", usage=Usage(prompt_tokens=3, completion_tokens=2, total_tokens=5)
    )
    client = build_client(provider)
    try:
        r = client.post(
            "/v1/translate",
            json={"text": "hello", "profile": "general"},
            headers={"Authorization": "Bearer k"},
        )
        assert r.status_code == 200, r.text
        assert r.json()["usage"]["total_tokens"] == 5
    finally:
        app.dependency_overrides.clear()


def test_translate_accepts_x_api_key_header(client, provider):
    r = client.post(
        "/v1/translate",
        json={"text": "hello", "profile": "general"},
        headers={"X-API-Key": "sk-or-alt"},
    )
    assert r.status_code == 200
    _, creds = provider.calls[0]
    assert creds.api_key == "sk-or-alt"


def test_missing_credentials_returns_401(client):
    r = client.post("/v1/translate", json={"text": "hello"})
    assert r.status_code == 401
    assert r.json()["code"] == "missing_credentials"


def test_empty_text_is_rejected(client):
    r = client.post(
        "/v1/translate",
        json={"text": ""},
        headers={"Authorization": "Bearer k"},
    )
    assert r.status_code == 422  # pydantic validation


def test_provider_rate_limit_maps_to_429():
    provider = FakeProvider(error=ProviderError("slow down", upstream_status=429))
    client = build_client(provider)
    try:
        r = client.post(
            "/v1/translate",
            json={"text": "hello"},
            headers={"Authorization": "Bearer k"},
        )
        assert r.status_code == 429
        assert r.json()["code"] == "provider_rate_limited"
    finally:
        app.dependency_overrides.clear()


def test_stream_emits_sse_and_done():
    provider = FakeProvider(deltas=["ho", "la"])
    client = build_client(provider)
    try:
        with client.stream(
            "POST",
            "/v1/translate/stream",
            json={"text": "hello"},
            headers={"Authorization": "Bearer k"},
        ) as r:
            assert r.status_code == 200
            body = "".join(r.iter_text())
        assert '"delta": "ho"' in body
        assert "[DONE]" in body
    finally:
        app.dependency_overrides.clear()
