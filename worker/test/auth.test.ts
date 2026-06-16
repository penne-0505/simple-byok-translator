import { describe, expect, it } from "vitest";

import {
  createSession,
  hashPassword,
  verifyPassword,
  verifySession,
} from "../src/auth";

describe("password hashing (PBKDF2)", () => {
  it("verifies the correct password and rejects a wrong one", async () => {
    const stored = await hashPassword("correct horse");
    expect(stored.startsWith("pbkdf2$")).toBe(true);
    expect(await verifyPassword("correct horse", stored)).toBe(true);
    expect(await verifyPassword("wrong", stored)).toBe(false);
  });

  it("rejects a malformed stored hash", async () => {
    expect(await verifyPassword("x", "not-a-hash")).toBe(false);
  });
});

describe("stateless sessions (HMAC)", () => {
  const secret = "session-secret";
  const now = 1_000_000;

  it("round-trips a valid session", async () => {
    const token = await createSession("admin", secret, now);
    const payload = await verifySession(token, secret, now);
    expect(payload?.sub).toBe("admin");
    expect(payload?.exp).toBeGreaterThan(now);
  });

  it("rejects a tampered signature", async () => {
    const token = await createSession("admin", secret, now);
    const tampered = token.slice(0, -2) + (token.endsWith("A") ? "B" : "A");
    expect(await verifySession(tampered, secret, now)).toBeNull();
  });

  it("rejects a wrong secret", async () => {
    const token = await createSession("admin", secret, now);
    expect(await verifySession(token, "other-secret", now)).toBeNull();
  });

  it("rejects an expired session", async () => {
    const token = await createSession("admin", secret, now, 10);
    expect(await verifySession(token, secret, now + 20)).toBeNull();
  });

  it("rejects a garbage token", async () => {
    expect(await verifySession("garbage", secret, now)).toBeNull();
    expect(await verifySession("", secret, now)).toBeNull();
  });
});
