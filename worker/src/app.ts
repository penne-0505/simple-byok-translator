// HTTP wiring (TS mirror of main.py): the only HTTP-aware layer. All real work
// lives in engine/harness/provider/config, so this stays thin.

import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { streamSSE } from "hono/streaming";

import {
  createSession,
  hashPassword,
  nowSeconds,
  type SessionPayload,
  verifyPassword,
  verifySession,
} from "./auth";
import { ConfigStore } from "./config";
import {
  effectiveAdmin,
  getCredentials,
  loginConfigured,
  rotationAvailable,
  setAdminCredentials,
  type Env,
} from "./credentials";
import {
  ForbiddenError,
  InvalidCredentialsError,
  InvalidRequestError,
  LoginNotConfiguredError,
  RotationUnavailableError,
  TranslatorError,
} from "./errors";
import { TranslationEngine } from "./engine";
import {
  TranslateRequestSchema,
  type ErrorResponse,
  type TranslateRequest,
  type TranslateResponse,
} from "./schemas";
import { OpenRouterProvider } from "./provider";
import type { ChatProvider } from "./types";

export const VERSION = "0.1.0";

const SESSION_COOKIE = "session";

type Bindings = Env & { ASSETS?: Fetcher };
type Variables = { session: SessionPayload | null };

export interface AppDeps {
  store?: ConfigStore;
  provider?: ChatProvider;
}

async function parseTranslateRequest(body: unknown): Promise<TranslateRequest> {
  const parsed = TranslateRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new InvalidRequestError("invalid request body", {
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    });
  }
  return parsed.data;
}

export function createApp(deps: AppDeps = {}): Hono<{
  Bindings: Bindings;
  Variables: Variables;
}> {
  const store = deps.store ?? new ConfigStore();
  const provider =
    deps.provider ?? new OpenRouterProvider({ title: "simple-byok-translator" });
  const engine = new TranslationEngine(store, provider);

  const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();
  // Same-origin cookies; allow credentialed CORS for a separate dev frontend.
  app.use("*", cors({ origin: (o) => o, credentials: true }));

  // Resolve the session cookie (if any) once per request.
  app.use("*", async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE);
    let session: SessionPayload | null = null;
    if (token && c.env?.SESSION_SECRET) {
      session = await verifySession(token, c.env.SESSION_SECRET, nowSeconds());
    }
    c.set("session", session);
    await next();
  });

  app.onError((err, c) => {
    const e =
      err instanceof TranslatorError
        ? err
        : new TranslatorError(err instanceof Error ? err.message : "internal error");
    const payload: ErrorResponse = {
      code: e.code,
      message: e.message,
      details: e.details,
    };
    return c.json(payload, e.statusCode as 400);
  });

  app.get("/healthz", (c) => c.json({ status: "ok", version: VERSION }));

  app.get("/v1/config", (c) => c.json(store.publicConfig()));

  // ----- auth (single admin, no DB) --------------------------------------

  app.get("/auth/me", (c) => {
    const session = c.get("session");
    return c.json({
      authenticated: Boolean(session),
      username: session?.sub ?? null,
      login_configured: loginConfigured(c.env),
      // Whether a successful login unlocks a server-held key.
      server_key_available: Boolean(c.env?.OPENROUTER_KEY),
      // Whether the password/username can be rotated from the UI.
      rotation_available: rotationAvailable(c.env),
    });
  });

  app.post("/auth/login", async (c) => {
    if (!loginConfigured(c.env)) {
      throw new LoginNotConfiguredError("login is not configured on this deployment");
    }
    const body = (await safeJson(c)) as { username?: unknown; password?: unknown };
    const username = typeof body.username === "string" ? body.username : "";
    const password = typeof body.password === "string" ? body.password : "";
    const admin = await effectiveAdmin(c.env);
    // Always run the hash to keep timing/user-enumeration uniform.
    const passwordOk = await verifyPassword(password, admin.hash ?? "");
    if (!passwordOk || username !== admin.user) {
      throw new InvalidCredentialsError("invalid username or password");
    }
    await setSessionCookie(c, username);
    return c.json({ ok: true, username });
  });

  app.post("/auth/logout", (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  // Rotate the admin password (and optionally username) from the UI. Requires a
  // live session AND the current password (re-auth), and a KV binding to persist.
  app.post("/auth/change-password", async (c) => {
    if (!c.get("session")) throw new ForbiddenError("login required");
    if (!rotationAvailable(c.env)) {
      throw new RotationUnavailableError(
        "credential rotation requires an AUTH_KV binding",
      );
    }
    const body = (await safeJson(c)) as {
      current_password?: unknown;
      new_password?: unknown;
      new_username?: unknown;
    };
    const currentPassword =
      typeof body.current_password === "string" ? body.current_password : "";
    const newPassword = typeof body.new_password === "string" ? body.new_password : "";
    const newUsername =
      typeof body.new_username === "string" && body.new_username.trim()
        ? body.new_username.trim()
        : undefined;

    const admin = await effectiveAdmin(c.env);
    if (!(await verifyPassword(currentPassword, admin.hash ?? ""))) {
      throw new InvalidCredentialsError("current password is incorrect");
    }
    if (newPassword.length < 8) {
      throw new InvalidRequestError("new password must be at least 8 characters");
    }

    const finalUser = newUsername ?? admin.user;
    await setAdminCredentials(c.env, {
      user: finalUser,
      hash: await hashPassword(newPassword),
    });
    // Re-issue the session (the username may have changed).
    await setSessionCookie(c, finalUser ?? "admin");
    return c.json({ ok: true, username: finalUser });
  });

  async function setSessionCookie(
    c: Context<{ Bindings: Bindings; Variables: Variables }>,
    username: string,
  ): Promise<void> {
    const token = await createSession(username, c.env.SESSION_SECRET!, nowSeconds());
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      path: "/",
      maxAge: 30 * 24 * 60 * 60,
    });
  }

  // ----- translation -----------------------------------------------------

  app.post("/v1/translate", async (c) => {
    const credentials = getCredentials(c.req.raw.headers, c.env, {
      authenticated: Boolean(c.get("session")),
    });
    const req = await parseTranslateRequest(await safeJson(c));
    const outcome = await engine.translate(req, credentials);
    const usage = outcome.usage;
    const body: TranslateResponse = {
      translation: outcome.translation,
      model: outcome.model,
      profile: outcome.spec.profile.name,
      source_language: outcome.spec.sourceLanguage,
      target_language: outcome.spec.targetLanguage,
      usage: usage
        ? {
            prompt_tokens: usage.promptTokens,
            completion_tokens: usage.completionTokens,
            total_tokens: usage.totalTokens,
          }
        : undefined,
    };
    return c.json(body);
  });

  app.post("/v1/translate/stream", async (c) => {
    // Resolve credentials and validate before streaming so failures map to a
    // normal JSON error; once the stream starts, errors become a final event.
    const credentials = getCredentials(c.req.raw.headers, c.env, {
      authenticated: Boolean(c.get("session")),
    });
    const req = await parseTranslateRequest(await safeJson(c));
    return streamSSE(c, async (stream) => {
      try {
        for await (const delta of engine.stream(req, credentials)) {
          await stream.writeSSE({ data: JSON.stringify({ delta }) });
        }
      } catch (err) {
        const code = err instanceof TranslatorError ? err.code : "internal_error";
        const message = err instanceof Error ? err.message : "stream failed";
        await stream.writeSSE({ data: JSON.stringify({ error: { code, message } }) });
      }
      await stream.writeSSE({ data: "[DONE]" });
    });
  });

  // Static frontend (self-hosting). Matching asset paths are usually served by
  // the platform before the Worker; this fallback covers anything that reaches
  // the Worker (and is a no-op 404 in tests, where ASSETS is unbound).
  app.get("*", (c) => {
    if (c.env.ASSETS) return c.env.ASSETS.fetch(c.req.raw);
    return c.notFound();
  });

  return app;
}

async function safeJson(c: {
  req: { json: () => Promise<unknown> };
}): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new InvalidRequestError("request body must be valid JSON");
  }
}
