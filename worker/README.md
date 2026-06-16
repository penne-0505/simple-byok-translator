# simple-byok-translator — worker

The TypeScript Cloudflare Worker (Hono) — the backend. (It began as a port of a
Python/FastAPI prototype, since removed; the wire format stays snake_case JSON.)

Live: <https://simple-byok-translator.penneotibo.workers.dev>

## Layers

```text
routes (Hono)        src/app.ts      ← the only HTTP-aware layer + UI self-host
  └ TranslationEngine src/engine.ts  ← resolve → build → call → extract
      ├ ConfigStore   src/config.ts  ← bundled defaults + per-request overrides
      ├ harness       src/harness.ts ← pure prompt build + extraction
      └ ChatProvider  src/provider.ts← LLM boundary (OpenRouter); fake in tests
  getCredentials      src/credentials.ts ← the key seam (BYOK / server-key)
```

`src/index.ts` is the Worker entry and exports only the handler; everything else
lives in `src/app.ts` (workerd rejects non-handler named exports on the entry).

## Credential modes

Resolved in `src/credentials.ts`:

1. **BYOK (default, safe):** the caller's key arrives by `Authorization: Bearer`
   or `X-API-Key` and always wins. The OSS default holds no key — nothing to leak.
2. **Server-key (opt-in):** if the `OPENROUTER_KEY` secret is set, a keyless
   request may use it, but **only with a valid login session**. Without a session
   the server key is never used, so a key-but-no-login deploy is not an open relay.

This is what lets a phone / laptop translate without carrying the OpenRouter key:
they log in once (a session cookie), and the key stays a server secret.

## Login (single admin, no database)

`src/auth.ts` implements a single-admin login with no DB: the credential is a
PBKDF2 hash in a Worker Secret, and sessions are stateless HMAC-signed cookies.

- `POST /auth/login` `{username, password}` → sets an HttpOnly/Secure/SameSite
  session cookie (30-day TTL). `POST /auth/logout` clears it. `GET /auth/me`
  reports `{authenticated, username, login_configured, server_key_available}`.
- Login is enabled only when **all three** secrets are set: `ADMIN_USER`,
  `ADMIN_PASSWORD_HASH`, `SESSION_SECRET`. Otherwise the deployment is pure BYOK.
- Stateless sessions can't be revoked before expiry; rotate `SESSION_SECRET` to
  invalidate every session at once.
- PBKDF2 runs at 100k iterations — the maximum Cloudflare Workers' Web Crypto
  allows (higher values throw on the edge).

**Rotating the password / username from the UI.** Worker Secrets are immutable
at runtime, so the rotated hash is stored in a KV namespace (`AUTH_KV`) that
overrides the bootstrap `ADMIN_*` Secrets. `POST /auth/change-password`
(`{current_password, new_password, new_username?}`) requires a live session and
re-verifies the current password, then writes the new hash to KV. Without the
`AUTH_KV` binding the endpoint returns 501 (Secret-only, CLI-rotated). Create it
with `wrangler kv namespace create AUTH_KV` and add the binding to
`wrangler.jsonc`. KV is eventually consistent, so a rotation can take a few
seconds to apply across edge locations.

Set it up:

```bash
printf '%s' 'your-password' | npm run hash-password   # prints a pbkdf2$... hash
echo -n 'admin'      | npx wrangler secret put ADMIN_USER
echo -n '<the-hash>' | npx wrangler secret put ADMIN_PASSWORD_HASH
openssl rand -base64 32 | npx wrangler secret put SESSION_SECRET
```

## Develop & test

```bash
cd worker
npm install
npm test            # vitest: unit + integration (fake provider, no network)
npx tsc --noEmit    # types
npx wrangler dev    # local workerd (see caveat below)
```

Opt-in real E2E against OpenRouter:

```bash
TRANSLATOR_E2E=1 OPENROUTER_KEY=sk-or-... npx vitest run test/e2e.test.ts
```

> Caveat: `wrangler dev`'s local proxy blanks the incoming `Authorization` header
> value (workers-sdk#3513-class behavior), so BYOK-via-Authorization can't be
> exercised end-to-end locally. It works on the production edge (verified). Use
> the node E2E above, `X-Gate-Token`, or `wrangler dev --remote` for local auth.

## Deploy

```bash
npx wrangler deploy
# server-key + login (optional): set OPENROUTER_KEY plus the three login secrets
npx wrangler secret put OPENROUTER_KEY   # your key; encrypted at rest by Cloudflare
# then ADMIN_USER / ADMIN_PASSWORD_HASH / SESSION_SECRET (see "Login" above)
```

The Worker bakes in no key. `OPENROUTER_KEY` and the login secrets are Cloudflare
Secrets (unset = pure BYOK). To rotate, run `wrangler secret put` again.

| Method | Path                    | Purpose                              |
| ------ | ----------------------- | ------------------------------------ |
| POST   | `/auth/login`           | Start a session (sets a cookie).     |
| POST   | `/auth/logout`          | End the session.                     |
| POST   | `/auth/change-password` | Rotate password/username (KV-backed).|
| GET    | `/auth/me`              | Session / config status.             |

## Endpoints

| Method | Path                   | Purpose                                |
| ------ | ---------------------- | -------------------------------------- |
| GET    | `/healthz`             | Liveness.                              |
| GET    | `/v1/config`           | Non-secret defaults for UI population. |
| POST   | `/v1/translate`        | Translate, returns full text + usage.  |
| POST   | `/v1/translate/stream` | Translate, SSE token stream.           |
| GET    | `/*`                   | Bundled UI (Workers static assets).    |
