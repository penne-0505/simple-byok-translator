"""Process configuration (env-driven), distinct from translation defaults.

``defaults.yaml`` governs *translation* behavior; this governs *deployment*:
where to reach the provider, attribution headers, CORS, and an optional local
dev key. Read from the environment with the ``TRANSLATOR_`` prefix.
"""

from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

from app import resources


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="TRANSLATOR_",
        env_file=".env",
        extra="ignore",
    )

    # Translation defaults location (relative paths resolve against backend/).
    config_path: str = "config/defaults.yaml"

    # Provider / OpenRouter
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    openrouter_referer: str | None = None
    openrouter_title: str | None = "simple-byok-translator"
    request_timeout: float = 60.0

    # Optional fallback key for *local development only*. In production the key
    # is expected to arrive per request (BYOK) and this stays unset.
    #
    # Resolution order (see app.secret_source): this env var → OS keyring →
    # none. The keyring path keeps the at-rest copy encrypted instead of
    # plaintext on disk; prefer it over setting this var to a literal key.
    dev_api_key: str | None = None

    # OS keyring (libsecret / Secret Service) as the secure local home for the
    # dev key. Disabled automatically wherever no backend is available.
    use_keyring: bool = True
    keyring_service: str = "byok-translator"
    keyring_account: str = "openrouter"

    # Comma-separated origins for the future React frontend dev server.
    cors_origins: str = "*"

    # Optional override for the self-hosted static frontend directory. When
    # unset, the bundled frontend (source: <repo>/frontend, frozen: _MEIPASS)
    # is served if present.
    frontend_dir: str | None = None

    def resolved_config_path(self) -> Path:
        return resources.config_dir_path(self.config_path)

    def resolved_frontend_dir(self) -> Path:
        if self.frontend_dir:
            return Path(self.frontend_dir)
        return resources.frontend_dir()

    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]
