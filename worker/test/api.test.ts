import { describe, expect, it } from "vitest";

import { hashPassword } from "../src/auth";
import { ProviderError } from "../src/errors";
import { createApp } from "../src/app";
import { FakeKV, FakeProvider, makeStore } from "./helpers";

function jsonPost(
  app: ReturnType<typeof createApp>,
  path: string,
  body: unknown,
  env: Record<string, unknown>,
  headers: Record<string, string> = {},
) {
  return app.request(
    path,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    },
    env,
  );
}

// A login-enabled env with server-key mode and a known admin password.
async function loginEnv(extra: Record<string, string> = {}) {
  return {
    OPENROUTER_KEY: "srv-key",
    ADMIN_USER: "admin",
    ADMIN_PASSWORD_HASH: await hashPassword("pw123"),
    SESSION_SECRET: "test-session-secret",
    ...extra,
  };
}

function cookieFrom(res: Response): string {
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

function appWith(provider: FakeProvider) {
  return createApp({ store: makeStore(), provider });
}

function post(app: ReturnType<typeof createApp>, body: unknown, headers: Record<string, string> = {}) {
  return app.request("/v1/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("HTTP surface", () => {
  it("GET /healthz", async () => {
    const res = await appWith(new FakeProvider()).request("/healthz");
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).status).toBe("ok");
  });

  it("GET /v1/config is public and secret-free", async () => {
    const res = await appWith(new FakeProvider()).request("/v1/config");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.default_model).toBe("google/gemini-2.5-flash");
    expect(body.profiles.map((p: { name: string }) => p.name)).toContain("general");
    expect(JSON.stringify(body).toLowerCase()).not.toContain("api_key");
  });

  it("translates on the happy path and threads the BYOK key", async () => {
    const provider = new FakeProvider({ reply: "hola [[hola mundo]]" });
    const res = await post(
      appWith(provider),
      { text: "hello", profile: "general", target_language: "Spanish" },
      { Authorization: "Bearer sk-or-user-key" },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.translation).toBe("hola mundo");
    expect(body.target_language).toBe("Spanish");
    expect(provider.calls[0].credentials.apiKey).toBe("sk-or-user-key");
  });

  it("accepts the X-API-Key header", async () => {
    const provider = new FakeProvider({ reply: "[[x]]" });
    const res = await post(appWith(provider), { text: "hi", profile: "general" }, {
      "X-API-Key": "sk-or-alt",
    });
    expect(res.status).toBe(200);
    expect(provider.calls[0].credentials.apiKey).toBe("sk-or-alt");
  });

  it("serializes usage", async () => {
    const provider = new FakeProvider({
      reply: "[[hola]]",
      usage: { promptTokens: 3, completionTokens: 2, totalTokens: 5 },
    });
    const res = await post(appWith(provider), { text: "hi", profile: "general" }, {
      Authorization: "Bearer k",
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).usage.total_tokens).toBe(5);
  });

  it("returns 401 when no key is provided", async () => {
    const res = await post(appWith(new FakeProvider()), { text: "hello" });
    expect(res.status).toBe(401);
    expect(((await res.json()) as any).code).toBe("missing_credentials");
  });

  it("rejects empty text with 422", async () => {
    const res = await post(appWith(new FakeProvider()), { text: "" }, {
      Authorization: "Bearer k",
    });
    expect(res.status).toBe(422);
  });

  it("maps an upstream rate limit to 429", async () => {
    const provider = new FakeProvider({ error: new ProviderError("slow down", 429) });
    const res = await post(appWith(provider), { text: "hello" }, {
      Authorization: "Bearer k",
    });
    expect(res.status).toBe(429);
    expect(((await res.json()) as any).code).toBe("provider_rate_limited");
  });

  it("logs in, then uses the server key with the session cookie", async () => {
    const provider = new FakeProvider({ reply: "[[hola]]" });
    const app = createApp({ store: makeStore(), provider });
    const env = await loginEnv();

    const login = await app.request(
      "/auth/login",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "pw123" }),
      },
      env,
    );
    expect(login.status).toBe(200);
    const cookie = cookieFrom(login);
    expect(cookie.startsWith("session=")).toBe(true);

    const res = await app.request(
      "/v1/translate",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ text: "hi", profile: "general" }),
      },
      env,
    );
    expect(res.status).toBe(200);
    expect(provider.calls[0].credentials.apiKey).toBe("srv-key");
  });

  it("refuses the server key without a session (403)", async () => {
    const app = createApp({ store: makeStore(), provider: new FakeProvider() });
    const res = await app.request(
      "/v1/translate",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "hi" }),
      },
      await loginEnv(),
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as any).code).toBe("forbidden");
  });

  it("rejects a wrong password with 401", async () => {
    const app = createApp({ store: makeStore(), provider: new FakeProvider() });
    const res = await app.request(
      "/auth/login",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "WRONG" }),
      },
      await loginEnv(),
    );
    expect(res.status).toBe(401);
    expect(((await res.json()) as any).code).toBe("invalid_credentials");
  });

  it("returns 501 from /auth/login when login is not configured", async () => {
    const app = createApp({ store: makeStore(), provider: new FakeProvider() });
    const res = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "x" }),
    });
    expect(res.status).toBe(501);
  });

  it("/auth/me reflects authentication state", async () => {
    const app = createApp({ store: makeStore(), provider: new FakeProvider() });
    const env = await loginEnv();
    const anon = await app.request("/auth/me", {}, env);
    expect((await anon.json() as any).authenticated).toBe(false);
    expect((await (await app.request("/auth/me", {}, env)).json() as any).login_configured).toBe(true);

    const login = await app.request(
      "/auth/login",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "pw123" }),
      },
      env,
    );
    const me = await app.request("/auth/me", { headers: { Cookie: cookieFrom(login) } }, env);
    const body = (await me.json()) as any;
    expect(body.authenticated).toBe(true);
    expect(body.username).toBe("admin");
  });

  it("rotates the password from the UI (KV-backed)", async () => {
    const app = createApp({ store: makeStore(), provider: new FakeProvider() });
    const env = { ...(await loginEnv()), AUTH_KV: new FakeKV() };

    const login = await jsonPost(app, "/auth/login", { username: "admin", password: "pw123" }, env);
    const cookie = cookieFrom(login);

    const change = await jsonPost(
      app,
      "/auth/change-password",
      { current_password: "pw123", new_password: "newpassword1" },
      env,
      { Cookie: cookie },
    );
    expect(change.status).toBe(200);

    const old = await jsonPost(app, "/auth/login", { username: "admin", password: "pw123" }, env);
    expect(old.status).toBe(401);
    const fresh = await jsonPost(app, "/auth/login", { username: "admin", password: "newpassword1" }, env);
    expect(fresh.status).toBe(200);
  });

  it("can also change the username", async () => {
    const app = createApp({ store: makeStore(), provider: new FakeProvider() });
    const env = { ...(await loginEnv()), AUTH_KV: new FakeKV() };
    const login = await jsonPost(app, "/auth/login", { username: "admin", password: "pw123" }, env);
    const change = await jsonPost(
      app,
      "/auth/change-password",
      { current_password: "pw123", new_password: "newpassword1", new_username: "boss" },
      env,
      { Cookie: cookieFrom(login) },
    );
    expect(change.status).toBe(200);
    expect((await jsonPost(app, "/auth/login", { username: "boss", password: "newpassword1" }, env)).status).toBe(200);
    expect((await jsonPost(app, "/auth/login", { username: "admin", password: "newpassword1" }, env)).status).toBe(401);
  });

  it("change-password requires a session (403)", async () => {
    const app = createApp({ store: makeStore(), provider: new FakeProvider() });
    const env = { ...(await loginEnv()), AUTH_KV: new FakeKV() };
    const res = await jsonPost(
      app,
      "/auth/change-password",
      { current_password: "pw123", new_password: "newpassword1" },
      env,
    );
    expect(res.status).toBe(403);
  });

  it("change-password rejects a wrong current password (401)", async () => {
    const app = createApp({ store: makeStore(), provider: new FakeProvider() });
    const env = { ...(await loginEnv()), AUTH_KV: new FakeKV() };
    const login = await jsonPost(app, "/auth/login", { username: "admin", password: "pw123" }, env);
    const res = await jsonPost(
      app,
      "/auth/change-password",
      { current_password: "WRONG", new_password: "newpassword1" },
      env,
      { Cookie: cookieFrom(login) },
    );
    expect(res.status).toBe(401);
  });

  it("change-password is 501 without a KV binding", async () => {
    const app = createApp({ store: makeStore(), provider: new FakeProvider() });
    const env = await loginEnv(); // no AUTH_KV
    const login = await jsonPost(app, "/auth/login", { username: "admin", password: "pw123" }, env);
    const res = await jsonPost(
      app,
      "/auth/change-password",
      { current_password: "pw123", new_password: "newpassword1" },
      env,
      { Cookie: cookieFrom(login) },
    );
    expect(res.status).toBe(501);
    expect(((await res.json()) as any).code).toBe("rotation_unavailable");
  });

  it("streams SSE deltas and a final [DONE]", async () => {
    const provider = new FakeProvider({ deltas: ["ho", "la"] });
    const res = await appWith(provider).request("/v1/translate/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer k" },
      body: JSON.stringify({ text: "hello" }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('"delta":"ho"');
    expect(text).toContain("[DONE]");
  });
});
