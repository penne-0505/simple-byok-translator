"""HTTP request/response models (the wire contract for the frontend).

Every override here is optional. Omitting a field means "use the bundled
default", which is what keeps simple calls simple while still allowing
per-request customization of model, instruction, harness profile, and sampling.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class GlossaryEntryModel(BaseModel):
    source: str
    target: str
    note: str | None = None


class TranslateRequest(BaseModel):
    text: str = Field(min_length=1, description="Source text to translate.")

    # Routing / language
    target_language: str | None = Field(
        default=None, description="Target language; falls back to server default."
    )
    source_language: str | None = Field(
        default=None, description='Source language, or "auto" to let the model detect.'
    )
    model: str | None = Field(
        default=None, description="OpenRouter model slug; falls back to default."
    )
    profile: str | None = Field(
        default=None,
        description="Harness profile name; falls back to the model's mapped profile.",
    )

    # Instruction customization
    instruction: str | None = Field(
        default=None, description="Extra or replacement translation instruction."
    )
    instruction_mode: str = Field(
        default="append",
        description='"append" (to the base instruction) or "replace".',
    )
    tone: str | None = Field(default=None, description="Desired tone/register.")
    glossary: list[GlossaryEntryModel] = Field(default_factory=list)

    # Sampling overrides
    temperature: float | None = None
    top_p: float | None = None
    max_tokens: int | None = None

    # Reasoning (OpenRouter unified `reasoning` param). reasoning_effort is the
    # convenient knob; reasoning is the full object for max_tokens/exclude/etc.
    # The two are merged (effort wins) over any profile default.
    reasoning_effort: str | None = Field(
        default=None,
        description='Reasoning effort: "none"|"minimal"|"low"|"medium"|"high"|"xhigh".',
    )
    reasoning: dict | None = Field(
        default=None,
        description="Full OpenRouter reasoning object (effort/max_tokens/exclude/enabled).",
    )

    extra_params: dict = Field(
        default_factory=dict, description="Provider-specific passthrough fields."
    )


class UsageModel(BaseModel):
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None


class TranslateResponse(BaseModel):
    translation: str
    model: str
    profile: str
    source_language: str
    target_language: str
    usage: UsageModel | None = None


class ProfileInfo(BaseModel):
    name: str
    description: str = ""


class PublicConfig(BaseModel):
    """Non-secret view of the server defaults, for populating UI."""

    default_model: str
    default_source_language: str
    default_target_language: str
    base_instruction: str
    default_profile: str
    profiles: list[ProfileInfo]
    model_profile_map: dict[str, str]
    known_models: list[str] = Field(default_factory=list)
    reasoning_efforts: list[str] = Field(default_factory=list)


class ErrorResponse(BaseModel):
    code: str
    message: str
    details: dict = Field(default_factory=dict)
