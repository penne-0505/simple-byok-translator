"""FastAPI wiring: lifespan, dependency injection, routes, error mapping.

This module is the only place that knows about HTTP. It is deliberately thin —
all real work lives in the engine/harness/provider layers, so replacing the web
framework (or adding a CLI) would not touch translation logic.
"""

from __future__ import annotations

import json
from contextlib import asynccontextmanager
from dataclasses import asdict
from typing import Annotated, AsyncIterator

from fastapi import Depends, FastAPI, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from app import __version__
from app.config_store import ConfigStore
from app.errors import MissingCredentialsError, TranslatorError
from app.providers.base import Credentials
from app.providers.openrouter import OpenRouterProvider
from app.secret_source import resolve_dev_api_key
from app.schemas import (
    ErrorResponse,
    PublicConfig,
    TranslateRequest,
    TranslateResponse,
    UsageModel,
)
from app.settings import Settings
from app.translation import TranslationEngine


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = Settings()
    store = ConfigStore.from_yaml(settings.resolved_config_path())
    provider = OpenRouterProvider(
        base_url=settings.openrouter_base_url,
        referer=settings.openrouter_referer,
        title=settings.openrouter_title,
        timeout=settings.request_timeout,
    )
    app.state.settings = settings
    # Resolve the optional local dev key once at startup (env → keyring → none).
    app.state.dev_api_key = resolve_dev_api_key(settings)
    app.state.engine = TranslationEngine(store, provider)
    app.state.provider = provider
    try:
        yield
    finally:
        await provider.aclose()


app = FastAPI(
    title="simple-byok-translator",
    version=__version__,
    summary="BYOK OpenRouter-compatible translation backend.",
    lifespan=lifespan,
)


def _install_cors(app: FastAPI) -> None:
    # Origins are read at startup; default "*" suits local React dev.
    settings = Settings()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list(),
        allow_methods=["*"],
        allow_headers=["*"],
    )


_install_cors(app)


# ----- dependencies ------------------------------------------------------


def get_engine(request: Request) -> TranslationEngine:
    return request.app.state.engine


def get_credentials(
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
    x_api_key: Annotated[str | None, Header()] = None,
) -> Credentials:
    """Extract the user's BYOK key. Never logged, never stored.

    Order: ``Authorization: Bearer <key>`` → ``X-API-Key: <key>`` → optional
    server ``dev_api_key`` (local development only).
    """
    if authorization and authorization.lower().startswith("bearer "):
        return Credentials(api_key=authorization[7:].strip())
    if x_api_key:
        return Credentials(api_key=x_api_key.strip())
    dev_key = getattr(request.app.state, "dev_api_key", None)
    if dev_key:
        return Credentials(api_key=dev_key)
    raise MissingCredentialsError(
        "Provide an OpenRouter key via 'Authorization: Bearer <key>' or 'X-API-Key'."
    )


EngineDep = Annotated[TranslationEngine, Depends(get_engine)]
CredentialsDep = Annotated[Credentials, Depends(get_credentials)]


# ----- error mapping -----------------------------------------------------


@app.exception_handler(TranslatorError)
async def _handle_translator_error(_: Request, exc: TranslatorError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content=ErrorResponse(
            code=exc.code, message=exc.message, details=exc.details
        ).model_dump(),
    )


# ----- routes ------------------------------------------------------------


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok", "version": __version__}


@app.get("/v1/config", response_model=PublicConfig)
async def get_config(engine: EngineDep) -> PublicConfig:
    """Non-secret defaults so a UI can populate its controls."""
    return engine.store.public_config()


@app.post("/v1/translate", response_model=TranslateResponse)
async def translate(
    req: TranslateRequest, engine: EngineDep, credentials: CredentialsDep
) -> TranslateResponse:
    outcome = await engine.translate(req, credentials)
    usage = outcome.usage
    return TranslateResponse(
        translation=outcome.translation,
        model=outcome.model,
        profile=outcome.spec.profile.name,
        source_language=outcome.spec.source_language,
        target_language=outcome.spec.target_language,
        usage=UsageModel(**asdict(usage)) if usage else None,
    )


@app.post("/v1/translate/stream")
async def translate_stream(
    req: TranslateRequest, engine: EngineDep, credentials: CredentialsDep
) -> StreamingResponse:
    """Server-Sent Events stream of output deltas.

    Each event is ``data: {"delta": "..."}``; the stream ends with
    ``data: [DONE]``. Errors raised mid-stream are emitted as a final
    ``data: {"error": {...}}`` event since headers are already sent.
    """

    async def event_source() -> AsyncIterator[str]:
        try:
            async for delta in engine.stream(req, credentials):
                yield f"data: {json.dumps({'delta': delta}, ensure_ascii=False)}\n\n"
        except TranslatorError as exc:
            payload = {"error": {"code": exc.code, "message": exc.message}}
            yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_source(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ----- static frontend (self-hosting) ------------------------------------
# Mounted LAST so the API routes above always take precedence. Lets the single
# binary serve the UI at "/" on the same origin as the API. When the React
# frontend lands, point TRANSLATOR_FRONTEND_DIR at its build output instead.
def _mount_frontend(app: FastAPI) -> None:
    frontend = Settings().resolved_frontend_dir()
    if frontend.is_dir():
        app.mount("/", StaticFiles(directory=str(frontend), html=True), name="frontend")


_mount_frontend(app)
