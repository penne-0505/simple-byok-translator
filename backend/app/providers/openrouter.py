"""OpenRouter implementation of :class:`ChatProvider`.

OpenRouter exposes an OpenAI-compatible ``/chat/completions`` endpoint, so this
file is deliberately thin: marshal the neutral ``ChatRequest`` into the wire
format, attach the per-call bearer key, and unmarshal the response. Any other
OpenAI-compatible gateway can be supported by subclassing and overriding the
base URL / default headers.
"""

from __future__ import annotations

import json
from typing import Any, AsyncIterator

import httpx

from app.errors import ProviderError
from app.providers.base import (
    ChatProvider,
    ChatRequest,
    ChatResult,
    Credentials,
    SamplingParams,
    Usage,
)


def _body(request: ChatRequest, *, stream: bool) -> dict[str, Any]:
    s: SamplingParams = request.sampling
    body: dict[str, Any] = {
        "model": request.model,
        "messages": [{"role": m.role, "content": m.content} for m in request.messages],
        "stream": stream,
    }
    if s.temperature is not None:
        body["temperature"] = s.temperature
    if s.top_p is not None:
        body["top_p"] = s.top_p
    if s.max_tokens is not None:
        body["max_tokens"] = s.max_tokens
    if s.stop:
        body["stop"] = s.stop
    # Provider-specific passthrough (e.g. {"provider": {"order": [...]}}).
    for key, value in s.extra.items():
        body.setdefault(key, value)
    return body


def _usage(raw: dict[str, Any] | None) -> Usage | None:
    if not raw:
        return None
    return Usage(
        prompt_tokens=raw.get("prompt_tokens"),
        completion_tokens=raw.get("completion_tokens"),
        total_tokens=raw.get("total_tokens"),
    )


class OpenRouterProvider(ChatProvider):
    name = "openrouter"

    def __init__(
        self,
        *,
        base_url: str = "https://openrouter.ai/api/v1",
        referer: str | None = None,
        title: str | None = None,
        timeout: float = 60.0,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        # HTTP-Referer / X-Title are OpenRouter attribution headers, not secrets.
        self._app_headers: dict[str, str] = {}
        if referer:
            self._app_headers["HTTP-Referer"] = referer
        if title:
            self._app_headers["X-Title"] = title
        self._client = client or httpx.AsyncClient(timeout=timeout)

    def _headers(self, credentials: Credentials) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {credentials.api_key}",
            "Content-Type": "application/json",
            **self._app_headers,
        }

    async def complete(
        self, request: ChatRequest, credentials: Credentials
    ) -> ChatResult:
        try:
            resp = await self._client.post(
                f"{self._base_url}/chat/completions",
                headers=self._headers(credentials),
                json=_body(request, stream=False),
            )
        except httpx.HTTPError as exc:
            raise ProviderError(f"OpenRouter request failed: {exc}") from exc

        if resp.status_code >= 400:
            raise ProviderError(
                _error_message(resp),
                upstream_status=resp.status_code,
            )

        data = resp.json()
        choice = (data.get("choices") or [{}])[0]
        message = choice.get("message") or {}
        return ChatResult(
            text=message.get("content") or "",
            model=data.get("model") or request.model,
            usage=_usage(data.get("usage")),
            finish_reason=choice.get("finish_reason"),
        )

    async def stream(
        self, request: ChatRequest, credentials: Credentials
    ) -> AsyncIterator[str]:
        try:
            async with self._client.stream(
                "POST",
                f"{self._base_url}/chat/completions",
                headers=self._headers(credentials),
                json=_body(request, stream=True),
            ) as resp:
                if resp.status_code >= 400:
                    body = await resp.aread()
                    raise ProviderError(
                        _error_message_from_bytes(resp.status_code, body),
                        upstream_status=resp.status_code,
                    )
                async for line in resp.aiter_lines():
                    delta = _parse_sse_delta(line)
                    if delta:
                        yield delta
        except httpx.HTTPError as exc:
            raise ProviderError(f"OpenRouter stream failed: {exc}") from exc

    async def aclose(self) -> None:
        await self._client.aclose()


def _parse_sse_delta(line: str) -> str | None:
    """Extract the content delta from one SSE line, or ``None`` to skip it."""
    line = line.strip()
    if not line or line.startswith(":"):  # comments / keep-alive
        return None
    if not line.startswith("data:"):
        return None
    payload = line[len("data:") :].strip()
    if payload == "[DONE]":
        return None
    try:
        chunk = json.loads(payload)
    except json.JSONDecodeError:
        return None
    choices = chunk.get("choices") or []
    if not choices:
        return None
    return (choices[0].get("delta") or {}).get("content") or None


def _error_message(resp: httpx.Response) -> str:
    try:
        data = resp.json()
        msg = (data.get("error") or {}).get("message") or data.get("message")
        if msg:
            return str(msg)
    except (json.JSONDecodeError, ValueError):
        pass
    return f"OpenRouter returned HTTP {resp.status_code}"


def _error_message_from_bytes(status: int, body: bytes) -> str:
    try:
        data = json.loads(body)
        msg = (data.get("error") or {}).get("message") or data.get("message")
        if msg:
            return str(msg)
    except (json.JSONDecodeError, ValueError):
        pass
    return f"OpenRouter returned HTTP {status}"
