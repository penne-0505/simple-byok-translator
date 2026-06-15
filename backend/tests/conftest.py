"""Shared fixtures: a fake provider and small in-memory config stores.

Tests never hit the network. The fake provider records what it was called with
so we can assert that credentials and rendered prompts flow through correctly.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

# Keep the test suite hermetic: never touch the OS keyring / DBus during tests,
# regardless of the developer's local environment.
os.environ.setdefault("TRANSLATOR_USE_KEYRING", "false")

from app.config_store import ConfigStore
from app.providers.base import ChatRequest, ChatResult, Credentials, Usage

BACKEND_DIR = Path(__file__).resolve().parent.parent
REAL_CONFIG = BACKEND_DIR / "config" / "defaults.yaml"


class FakeProvider:
    """A ChatProvider stand-in with canned replies and call recording."""

    name = "fake"

    def __init__(
        self,
        reply: str = "hola mundo",
        usage: Usage | None = None,
        error: Exception | None = None,
        deltas: list[str] | None = None,
    ) -> None:
        self.reply = reply
        self.usage = usage
        self.error = error
        self.deltas = deltas
        self.calls: list[tuple[ChatRequest, Credentials]] = []
        self.closed = False

    async def complete(
        self, request: ChatRequest, credentials: Credentials
    ) -> ChatResult:
        self.calls.append((request, credentials))
        if self.error:
            raise self.error
        return ChatResult(text=self.reply, model=request.model, usage=self.usage)

    async def stream(self, request: ChatRequest, credentials: Credentials):
        self.calls.append((request, credentials))
        if self.error:
            raise self.error
        for delta in self.deltas or [self.reply]:
            yield delta

    async def aclose(self) -> None:
        self.closed = True


def make_store(**overrides) -> ConfigStore:
    """Build a small, deterministic store for unit tests."""
    raw = {
        "default_model": "google/gemini-2.5-flash",
        "default_source_language": "auto",
        "default_target_language": "Spanish",
        "default_profile": "general",
        "default_stream_profile": "raw",
        "model_profile_map": {
            "anthropic/*": "claude",
            "google/*": "gemini",
        },
        "known_models": ["google/gemini-2.5-flash", "anthropic/claude-sonnet-4"],
        "base_instruction": "You are a translator.",
        "profiles": {
            "general": {
                "description": "default",
                "temperature": 0.3,
                "output_open": "[[",
                "output_close": "]]",
                "system_template": (
                    "{instruction}\nFrom {source_language} to "
                    "{target_language}. {tone_line}\nGlossary:\n"
                    "{glossary_block}\nWrap in {output_open}{output_close}."
                ),
            },
            "claude": {
                "description": "anthropic",
                "temperature": 0.2,
                "output_open": "<t>",
                "output_close": "</t>",
                "system_template": (
                    "{instruction}\n{source_language}->{target_language} "
                    "{tone_line} {glossary_block} {output_open}{output_close}"
                ),
            },
            "gemini": {
                "description": "google",
                "temperature": 0.4,
                "system_template": "{instruction} {source_language} {target_language}",
            },
            "raw": {
                "description": "no delimiters",
                "temperature": 0.3,
                "system_template": "{instruction} {source_language}->{target_language}",
            },
        },
    }
    raw.update(overrides)
    return ConfigStore(raw)


@pytest.fixture
def store() -> ConfigStore:
    return make_store()


@pytest.fixture
def real_store() -> ConfigStore:
    return ConfigStore.from_yaml(REAL_CONFIG)
