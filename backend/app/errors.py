"""Domain error types.

These are provider/transport agnostic so routes can translate them into HTTP
responses in one place (see ``app.main``). Nothing here ever carries a secret.
"""

from __future__ import annotations


class TranslatorError(Exception):
    """Base class for all expected, mapped-to-HTTP errors."""

    status_code: int = 500
    code: str = "internal_error"

    def __init__(self, message: str, *, details: dict | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = details or {}


class MissingCredentialsError(TranslatorError):
    status_code = 401
    code = "missing_credentials"


class ConfigError(TranslatorError):
    """Misconfigured server-side defaults (bad YAML, unknown profile, ...)."""

    status_code = 500
    code = "config_error"


class InvalidRequestError(TranslatorError):
    status_code = 422
    code = "invalid_request"


class ProviderError(TranslatorError):
    """Upstream LLM provider returned an error or was unreachable.

    ``upstream_status`` is the provider's HTTP status when available so the
    caller can distinguish a bad key (401) from rate limiting (429), etc.
    """

    status_code = 502
    code = "provider_error"

    def __init__(
        self,
        message: str,
        *,
        upstream_status: int | None = None,
        details: dict | None = None,
    ) -> None:
        super().__init__(message, details=details)
        self.upstream_status = upstream_status
        # Surface auth/rate-limit upstream failures with a faithful status.
        if upstream_status in (401, 403):
            self.status_code = upstream_status
            self.code = "provider_unauthorized"
        elif upstream_status == 429:
            self.status_code = 429
            self.code = "provider_rate_limited"
