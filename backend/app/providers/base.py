"""The boundary between the translation logic and any concrete LLM backend.

Everything above this layer (harness, engine, routes) speaks only in terms of
``ChatRequest`` / ``ChatResult`` and the ``ChatProvider`` protocol. Swapping
OpenRouter for a native Anthropic/OpenAI client, a local model, or a fake used
in tests is therefore a single object substitution with no ripple effects.

Credentials are passed *per call*, never stored on the provider instance. This
is what makes BYOK safe: the process holds no long-lived user key, and the same
provider object serves every user.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import AsyncIterator, Literal, Protocol, runtime_checkable

Role = Literal["system", "user", "assistant"]


@dataclass(slots=True)
class ChatMessage:
    role: Role
    content: str


@dataclass(slots=True)
class SamplingParams:
    """Provider-neutral sampling knobs. ``None`` means "let the provider decide".

    ``extra`` is an escape hatch for provider-specific fields (e.g. OpenRouter
    routing preferences) without widening this contract.
    """

    temperature: float | None = None
    top_p: float | None = None
    max_tokens: int | None = None
    stop: list[str] | None = None
    extra: dict = field(default_factory=dict)


@dataclass(slots=True)
class ChatRequest:
    model: str
    messages: list[ChatMessage]
    sampling: SamplingParams = field(default_factory=SamplingParams)


@dataclass(slots=True)
class Credentials:
    """A single user's bring-your-own key. Never logged, never persisted."""

    api_key: str

    def __repr__(self) -> str:  # pragma: no cover - defensive, avoids leaks
        return "Credentials(api_key=***redacted***)"


@dataclass(slots=True)
class Usage:
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None


@dataclass(slots=True)
class ChatResult:
    text: str
    model: str
    usage: Usage | None = None
    finish_reason: str | None = None


@runtime_checkable
class ChatProvider(Protocol):
    """A minimal chat-completion backend.

    Implementations must be safe to share across concurrent requests and must
    treat ``credentials`` as call-scoped.
    """

    name: str

    async def complete(
        self, request: ChatRequest, credentials: Credentials
    ) -> ChatResult: ...

    def stream(
        self, request: ChatRequest, credentials: Credentials
    ) -> AsyncIterator[str]:
        """Yield output text deltas as they arrive."""
        ...

    async def aclose(self) -> None:
        """Release any held resources (HTTP clients, sockets)."""
        ...
