"""Resolve the optional local *dev* key from the most secure available source.

This is only about the server-side convenience key used when a request omits
one (so local curl / the UI's empty-key path still work). In production the key
is bring-your-own per request and none of this runs.

Order of preference:

1. ``TRANSLATOR_DEV_API_KEY`` env var (explicit; useful in CI / containers).
2. OS keyring (libsecret / Secret Service) — encrypted at rest, gated by the
   login session. This is the recommended local home for the key.
3. Nothing — a keyless request then gets a clean 401.

The key is never logged here. Keyring failures (no backend, locked, DBus
quirks) degrade to ``None`` instead of crashing startup.
"""

from __future__ import annotations

import logging

from app.settings import Settings

log = logging.getLogger("byok-translator")


def resolve_dev_api_key(settings: Settings) -> str | None:
    if settings.dev_api_key:
        return settings.dev_api_key
    if settings.use_keyring:
        return _from_keyring(settings.keyring_service, settings.keyring_account)
    return None


def _from_keyring(service: str, account: str) -> str | None:
    try:
        import keyring
        from keyring.errors import KeyringError
    except ImportError:
        return None
    try:
        key = keyring.get_password(service, account)
    except KeyringError as exc:
        log.warning("keyring lookup failed (%s); continuing without a dev key", type(exc).__name__)
        return None
    except Exception as exc:  # noqa: BLE001 - DBus/backend issues must not crash boot
        log.warning("keyring unavailable (%s); continuing without a dev key", type(exc).__name__)
        return None
    if key:
        log.info("dev key loaded from OS keyring (%s/%s)", service, account)
    return key or None
