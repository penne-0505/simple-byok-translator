import { describe, expect, it } from "vitest";

import { getCredentials, loginConfigured } from "../src/credentials";
import { ForbiddenError, MissingCredentialsError } from "../src/errors";

const H = (o: Record<string, string>) => new Headers(o);

describe("getCredentials — BYOK (mode 1)", () => {
  it("extracts a Bearer key", () => {
    expect(getCredentials(H({ Authorization: "Bearer sk-or-abc" })).apiKey).toBe("sk-or-abc");
  });

  it("extracts X-API-Key", () => {
    expect(getCredentials(H({ "X-API-Key": "sk-or-xyz" })).apiKey).toBe("sk-or-xyz");
  });

  it("falls through an empty Bearer value to 401", () => {
    expect(() => getCredentials(H({ Authorization: "Bearer " }))).toThrow(MissingCredentialsError);
  });

  it("throws 401 with no key and no server key", () => {
    expect(() => getCredentials(H({}))).toThrow(MissingCredentialsError);
  });
});

describe("getCredentials — server key (mode 2, login-gated)", () => {
  const env = { OPENROUTER_KEY: "srv-key" };

  it("uses the server key for an authenticated session", () => {
    expect(getCredentials(H({}), env, { authenticated: true }).apiKey).toBe("srv-key");
  });

  it("refuses (403) without a session", () => {
    expect(() => getCredentials(H({}), env, { authenticated: false })).toThrow(ForbiddenError);
    expect(() => getCredentials(H({}), env)).toThrow(ForbiddenError);
  });

  it("lets BYOK win even when authenticated", () => {
    expect(
      getCredentials(H({ Authorization: "Bearer sk-or-mine" }), env, { authenticated: true })
        .apiKey,
    ).toBe("sk-or-mine");
  });
});

describe("loginConfigured", () => {
  it("is true only when all three secrets are present", () => {
    expect(
      loginConfigured({ ADMIN_USER: "a", ADMIN_PASSWORD_HASH: "h", SESSION_SECRET: "s" }),
    ).toBe(true);
    expect(loginConfigured({ ADMIN_USER: "a", ADMIN_PASSWORD_HASH: "h" })).toBe(false);
    expect(loginConfigured({})).toBe(false);
  });
});
