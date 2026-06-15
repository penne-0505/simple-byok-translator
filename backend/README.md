# simple-byok-translator — backend

A small, swappable backend for a bring-your-own-key (BYOK) translation app.
The user supplies their own OpenRouter key per request; the server stores
nothing. Default model, instruction, and per-model "translation assist" harness
ship bundled, and every one of them is overridable per request.

## Why it is shaped this way

The frontend will be replaced later (React), so the backend is the durable
part and is kept deliberately decoupled:

```text
routes (HTTP)            app/main.py        ← the only HTTP-aware layer
  └─ TranslationEngine   app/translation/   ← orchestration, no I/O specifics
       ├─ ConfigStore    app/config_store   ← defaults + per-request overrides
       ├─ harness        app/harness/       ← pure prompt build + extraction
       └─ ChatProvider   app/providers/     ← LLM boundary (OpenRouter impl)
```

`ChatProvider` is a `Protocol`. Swapping OpenRouter for a native Anthropic /
OpenAI client, a local model, or a test fake is one object substitution. The
harness and engine never learn which backend is in use.

## Customization model

Two layers, on purpose:

- **`config/defaults.yaml`** — *translation* policy: default model, base
  instruction, harness profiles, and the model→profile map. Edit this to
  retune defaults for a deployment; no code change needed.
- **environment (`TRANSLATOR_*`)** — *deployment* config: provider URL,
  attribution headers, CORS, optional local dev key. See `.env.example`.

Per request, precedence is: **bundled default < model→profile map < explicit
override**. A caller can override model, profile, instruction
(`append`/`replace`), tone, glossary, and sampling — or send only `text` and
get the bundled behavior.

## Run

```bash
cd backend
uv venv && uv pip install -e ".[dev]"
uv run uvicorn app.main:app --reload --port 8000   # dev (reload)
# or, the way the binary runs it:
uv run python -m app --port 8000
```

The server also self-hosts the throwaway UI: open <http://localhost:8000/>.
The API and UI share an origin, so the UI's "Backend URL" field can stay empty.
`GET /v1/config` returns the (secret-free) defaults so a UI can populate its
controls.

Translate (BYOK key in the header — never stored, never logged):

```bash
curl -s localhost:8000/v1/translate \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"text":"こんにちは、世界","target_language":"English"}'
```

Override model / profile / instruction per request:

```bash
curl -s localhost:8000/v1/translate \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -d '{
        "text":"The cat sat on the mat.",
        "target_language":"Japanese",
        "model":"anthropic/claude-opus-4.5",
        "instruction":"Use a literary register.",
        "tone":"poetic",
        "glossary":[{"source":"cat","target":"猫"}],
        "reasoning_effort":"high"
      }'
```

`reasoning_effort` is `none`/`minimal`/`low`/`medium`/`high`/`xhigh` (OpenRouter's
unified reasoning param); pass a full `reasoning` object for `max_tokens`/`exclude`.
A profile may set a default `reasoning:` block, which per-request values merge
over. Only reasoning-capable models honor it.

Streaming (SSE; `data: {"delta": "..."}` then `data: [DONE]`):

```bash
curl -N localhost:8000/v1/translate/stream \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -d '{"text":"Hello","target_language":"Japanese"}'
```

## Endpoints

| Method | Path                   | Purpose                                  |
| ------ | ---------------------- | ---------------------------------------- |
| GET    | `/healthz`             | Liveness.                                |
| GET    | `/v1/config`           | Non-secret defaults for UI population.   |
| POST   | `/v1/translate`        | Translate, returns full text + usage.    |
| POST   | `/v1/translate/stream` | Translate, SSE token stream.             |

## Security posture

- The key arrives per request (`Authorization: Bearer` or `X-API-Key`) and is
  held only for the duration of the call. It is never logged or persisted;
  `Credentials.__repr__` is redacted.
- The optional *local dev* key (used only when a request omits one) is resolved
  by `app/secret_source.py` in order: `TRANSLATOR_DEV_API_KEY` env →
  **OS keyring** (libsecret / Secret Service) → none. The keyring keeps the
  at-rest copy encrypted instead of plaintext on disk. Set it once:

  ```bash
  uv run python -c "import keyring; keyring.set_password('byok-translator','openrouter', input('key: '))"
  # or: secret-tool store --label='OpenRouter (byok-translator)' service byok-translator account openrouter
  ```

  In production leave all of this unset so a missing key is a clean 401 rather
  than a silent fallback. The single binary bakes in **no** key — it resolves
  the same way at runtime.
- Upstream auth/rate-limit failures are surfaced with faithful status codes
  (401/403/429) without echoing the key.

## Single-file binary

The whole app — API, bundled `defaults.yaml`, and the UI — packs into one
executable via PyInstaller. The binary holds no key: it is still BYOK
(`Authorization` header per request).

```bash
cd backend
uv pip install -e ".[build]"
uv run pyinstaller byok-translator.spec --clean --noconfirm
./dist/byok-translator --port 8000        # then open http://localhost:8000/
```

`app/resources.py` resolves the bundled `config/` and `frontend/` whether
running from source or from the unpacked binary, so no code path is
binary-specific.

Trade-offs worth knowing (these are inherent to onefile bundling, not bugs):

- The artifact is **per-platform/arch** — a Linux build runs on Linux only;
  rebuild on each target OS.
- Onefile unpacks to a temp dir on each start (~1s cold start). For a
  long-running server this is negligible; for rapid CLI-style invocation it is
  not ideal.
- When the React frontend lands, point `TRANSLATOR_FRONTEND_DIR` at its build
  output (or update the spec's `datas`) and rebuild; nothing else changes.

For server deployment a container image is usually the steadier long-term
distribution; the binary is the right tool when you want "download one file,
run it, no Python."

## Test

```bash
cd backend
uv run pytest
```

Tests never hit the network — a fake `ChatProvider` stands in and records the
credentials and prompts it received.
