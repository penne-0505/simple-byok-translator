"""Bundled defaults + per-request override resolution.

The store loads ``config/defaults.yaml`` once at startup. For each request it
produces a fully-resolved :class:`TranslationSpec` by layering, in order of
increasing precedence:

    bundled default  <  model→profile mapping  <  explicit request override

This is the single place where "what ships by default" and "what the user may
change" are defined, so the policy is easy to audit and adjust.
"""

from __future__ import annotations

import fnmatch
from pathlib import Path
from typing import Any

import yaml

from app.errors import ConfigError, InvalidRequestError
from app.harness.models import GlossaryEntry, HarnessProfile, TranslationSpec
from app.schemas import (
    ProfileInfo,
    PublicConfig,
    TranslateRequest,
)

# OpenRouter unified reasoning effort levels (provider-normalized).
ALLOWED_REASONING_EFFORTS = ("none", "minimal", "low", "medium", "high", "xhigh")


class ConfigStore:
    def __init__(self, raw: dict[str, Any]) -> None:
        self._raw = raw
        self.default_model: str = _require(raw, "default_model", str)
        self.default_source_language: str = raw.get("default_source_language", "auto")
        self.default_target_language: str = _require(
            raw, "default_target_language", str
        )
        self.base_instruction: str = _require(raw, "base_instruction", str).strip()
        self.default_profile: str = _require(raw, "default_profile", str)
        # Streaming can't post-extract delimiters (it needs the full reply), so
        # streaming requests default to a delimiter-free profile for clean
        # deltas. Falls back to default_profile when unset.
        self.default_stream_profile: str = raw.get(
            "default_stream_profile", self.default_profile
        )
        self.model_profile_map: dict[str, str] = raw.get("model_profile_map", {}) or {}
        self.known_models: list[str] = list(raw.get("known_models", []) or [])
        self._profiles: dict[str, HarnessProfile] = _load_profiles(raw)

        if self.default_profile not in self._profiles:
            raise ConfigError(
                f"default_profile '{self.default_profile}' is not defined"
            )
        if self.default_stream_profile not in self._profiles:
            raise ConfigError(
                f"default_stream_profile '{self.default_stream_profile}' is not defined"
            )
        for model_glob, profile_name in self.model_profile_map.items():
            if profile_name not in self._profiles:
                raise ConfigError(
                    f"model_profile_map['{model_glob}'] points to unknown "
                    f"profile '{profile_name}'"
                )

    # ----- construction --------------------------------------------------

    @classmethod
    def from_yaml(cls, path: str | Path) -> "ConfigStore":
        p = Path(path)
        if not p.is_file():
            raise ConfigError(f"defaults config not found: {p}")
        try:
            raw = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
        except yaml.YAMLError as exc:
            raise ConfigError(f"failed to parse {p}: {exc}") from exc
        if not isinstance(raw, dict):
            raise ConfigError(f"{p} must contain a mapping at the top level")
        return cls(raw)

    # ----- resolution ----------------------------------------------------

    def profile_for_model(self, model: str) -> HarnessProfile:
        """First glob match in declaration order wins; else the default."""
        for model_glob, profile_name in self.model_profile_map.items():
            if fnmatch.fnmatch(model, model_glob):
                return self._profiles[profile_name]
        return self._profiles[self.default_profile]

    def get_profile(self, name: str) -> HarnessProfile:
        try:
            return self._profiles[name]
        except KeyError:
            raise InvalidRequestError(
                f"unknown profile '{name}'",
                details={"available": sorted(self._profiles)},
            ) from None

    def resolve(self, req: TranslateRequest, *, stream: bool = False) -> TranslationSpec:
        model = req.model or self.default_model

        if req.profile is not None:
            # An explicit profile is always honored, even for streaming.
            profile = self.get_profile(req.profile)
        elif stream:
            profile = self._profiles[self.default_stream_profile]
        else:
            profile = self.profile_for_model(model)

        instruction = self._resolve_instruction(req)

        return TranslationSpec(
            text=req.text,
            source_language=req.source_language or self.default_source_language,
            target_language=req.target_language or self.default_target_language,
            instruction=instruction,
            model=model,
            profile=profile,
            tone=req.tone,
            glossary=[
                GlossaryEntry(source=g.source, target=g.target, note=g.note)
                for g in req.glossary
            ],
            temperature=_first(req.temperature, profile.temperature),
            top_p=_first(req.top_p, profile.top_p),
            max_tokens=_first(req.max_tokens, profile.max_tokens),
            reasoning=self._resolve_reasoning(req, profile),
            extra_params={**profile.extra_params, **req.extra_params},
        )

    def _resolve_reasoning(
        self, req: TranslateRequest, profile: HarnessProfile
    ) -> dict | None:
        """Merge profile default < request object < request effort."""
        merged: dict = {}
        if profile.reasoning:
            merged.update(profile.reasoning)
        if req.reasoning:
            merged.update(req.reasoning)
        if req.reasoning_effort is not None:
            merged["effort"] = req.reasoning_effort
        if not merged:
            return None
        effort = merged.get("effort")
        if effort is not None and effort not in ALLOWED_REASONING_EFFORTS:
            raise InvalidRequestError(
                f"reasoning effort must be one of {list(ALLOWED_REASONING_EFFORTS)}, "
                f"got '{effort}'"
            )
        return merged

    def _resolve_instruction(self, req: TranslateRequest) -> str:
        if req.instruction is None:
            return self.base_instruction
        mode = req.instruction_mode.lower()
        if mode == "replace":
            return req.instruction.strip()
        if mode == "append":
            return f"{self.base_instruction}\n\n{req.instruction.strip()}".strip()
        raise InvalidRequestError(
            f"instruction_mode must be 'append' or 'replace', got '{mode}'"
        )

    # ----- introspection -------------------------------------------------

    def public_config(self) -> PublicConfig:
        return PublicConfig(
            default_model=self.default_model,
            default_source_language=self.default_source_language,
            default_target_language=self.default_target_language,
            base_instruction=self.base_instruction,
            default_profile=self.default_profile,
            profiles=[
                ProfileInfo(name=p.name, description=p.description)
                for p in self._profiles.values()
            ],
            model_profile_map=self.model_profile_map,
            known_models=self.known_models,
            reasoning_efforts=list(ALLOWED_REASONING_EFFORTS),
        )


def _load_profiles(raw: dict[str, Any]) -> dict[str, HarnessProfile]:
    profiles_raw = raw.get("profiles")
    if not isinstance(profiles_raw, dict) or not profiles_raw:
        raise ConfigError("config must define a non-empty 'profiles' mapping")
    profiles: dict[str, HarnessProfile] = {}
    for name, body in profiles_raw.items():
        if not isinstance(body, dict):
            raise ConfigError(f"profile '{name}' must be a mapping")
        if "system_template" not in body:
            raise ConfigError(f"profile '{name}' is missing 'system_template'")
        profiles[name] = HarnessProfile(
            name=name,
            system_template=body["system_template"],
            temperature=body.get("temperature"),
            top_p=body.get("top_p"),
            max_tokens=body.get("max_tokens"),
            stop=body.get("stop"),
            output_open=body.get("output_open", ""),
            output_close=body.get("output_close", ""),
            extra_params=body.get("extra_params", {}) or {},
            reasoning=body.get("reasoning") or None,
            description=body.get("description", ""),
        )
    return profiles


def _require(raw: dict[str, Any], key: str, typ: type) -> Any:
    if key not in raw:
        raise ConfigError(f"config is missing required key '{key}'")
    value = raw[key]
    if not isinstance(value, typ):
        raise ConfigError(f"config key '{key}' must be {typ.__name__}")
    return value


def _first(*values: Any) -> Any:
    for v in values:
        if v is not None:
            return v
    return None
