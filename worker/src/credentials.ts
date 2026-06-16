// The single seam where the request's key is resolved. Two modes:
//
//   1. BYOK (default, safe): the caller's key arrives by header. Always wins.
//   2. Server-key (opt-in): if env.OPENROUTER_KEY is set, a keyless request may
//      use it — but ONLY when the request carries a valid login session. Without
//      a session the server key is never used, so a deployment that sets a key
//      but forgets to configure login is not an open relay.
//
// The OSS default is mode 1 with no server key configured: nothing to leak.
// The key is never logged or stored.

import { ForbiddenError, MissingCredentialsError } from "./errors";
import type { Credentials } from "./types";

export interface Env {
  // Optional server-side fallback key (a Worker Secret). Unset → pure BYOK.
  OPENROUTER_KEY?: string;
  // Single-admin login. ADMIN_USER / ADMIN_PASSWORD_HASH are the bootstrap
  // (Secret) floor; SESSION_SECRET signs sessions. All three enable login.
  ADMIN_USER?: string;
  ADMIN_PASSWORD_HASH?: string;
  SESSION_SECRET?: string;
  // Optional KV for runtime-mutable credentials (UI password rotation). Worker
  // Secrets are immutable at runtime, so rotation lives here. KV overrides the
  // bootstrap Secret when present.
  AUTH_KV?: KVNamespace;
}

const KV_ADMIN_USER = "admin_user";
const KV_ADMIN_HASH = "admin_password_hash";

/** Effective admin credentials: KV override (if any) over the bootstrap Secret. */
export async function effectiveAdmin(
  env: Env,
): Promise<{ user?: string; hash?: string }> {
  let user = env.ADMIN_USER;
  let hash = env.ADMIN_PASSWORD_HASH;
  if (env.AUTH_KV) {
    user = (await env.AUTH_KV.get(KV_ADMIN_USER)) ?? user;
    hash = (await env.AUTH_KV.get(KV_ADMIN_HASH)) ?? hash;
  }
  return { user, hash };
}

/** Persist a rotated credential to KV. Throws if KV is not bound. */
export async function setAdminCredentials(
  env: Env,
  next: { user?: string; hash: string },
): Promise<void> {
  if (!env.AUTH_KV) throw new Error("AUTH_KV is not bound");
  await env.AUTH_KV.put(KV_ADMIN_HASH, next.hash);
  if (next.user) await env.AUTH_KV.put(KV_ADMIN_USER, next.user);
}

/** Whether UI-driven credential rotation is available (needs a KV binding). */
export function rotationAvailable(env: Env | undefined): boolean {
  return Boolean(env?.AUTH_KV);
}

export function getCredentials(
  headers: Headers,
  env: Env = {},
  opts: { authenticated?: boolean } = {},
): Credentials {
  // 1. BYOK always wins. Require a non-empty token so a stray "Bearer " (e.g. a
  //    proxy that blanks the value) falls through rather than sending empty.
  const authorization = headers.get("authorization");
  if (authorization && authorization.toLowerCase().startsWith("bearer ")) {
    const key = authorization.slice(7).trim();
    if (key) return { apiKey: key };
  }
  const xApiKey = headers.get("x-api-key")?.trim();
  if (xApiKey) return { apiKey: xApiKey };

  // 2. Server-key fallback (opt-in), only for an authenticated session.
  if (env.OPENROUTER_KEY) {
    if (opts.authenticated) return { apiKey: env.OPENROUTER_KEY };
    throw new ForbiddenError("Server-key mode requires login.");
  }

  // 3. Nothing usable.
  throw new MissingCredentialsError(
    "Provide an OpenRouter key via 'Authorization: Bearer <key>' or 'X-API-Key', or log in.",
  );
}

/** Whether single-admin login is fully configured on this deployment. */
export function loginConfigured(env: Env | undefined): boolean {
  return Boolean(env?.ADMIN_USER && env?.ADMIN_PASSWORD_HASH && env?.SESSION_SECRET);
}
