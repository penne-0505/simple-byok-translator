"""Orchestrates config resolution, harness rendering, and the provider call.

The engine is the seam the routes depend on. It knows nothing about HTTP and
nothing about OpenRouter specifically — it composes a ``ConfigStore`` and any
``ChatProvider``. That makes it trivial to test against a fake provider and to
reuse from a CLI or a queue worker later.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import AsyncIterator

from app.config_store import ConfigStore
from app.harness import build_chat_request, extract_translation
from app.harness.models import TranslationSpec
from app.providers.base import ChatProvider, Credentials, Usage
from app.schemas import TranslateRequest


@dataclass(slots=True)
class TranslationOutcome:
    translation: str
    spec: TranslationSpec
    model: str
    usage: Usage | None


class TranslationEngine:
    def __init__(self, store: ConfigStore, provider: ChatProvider) -> None:
        self._store = store
        self._provider = provider

    async def translate(
        self, req: TranslateRequest, credentials: Credentials
    ) -> TranslationOutcome:
        spec = self._store.resolve(req)
        chat_request = build_chat_request(spec)
        result = await self._provider.complete(chat_request, credentials)
        translation = extract_translation(result.text, spec)
        return TranslationOutcome(
            translation=translation,
            spec=spec,
            model=result.model,
            usage=result.usage,
        )

    async def stream(
        self, req: TranslateRequest, credentials: Credentials
    ) -> AsyncIterator[str]:
        """Stream raw output deltas.

        Delimiter-based extraction is intentionally *not* applied here: it needs
        the full reply. Profiles intended for streaming should set empty
        delimiters so the raw deltas are already clean.
        """
        spec = self._store.resolve(req, stream=True)
        chat_request = build_chat_request(spec)
        async for delta in self._provider.stream(chat_request, credentials):
            yield delta

    @property
    def store(self) -> ConfigStore:
        return self._store
