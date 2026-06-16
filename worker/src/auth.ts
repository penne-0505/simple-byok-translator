// Single-admin auth primitives, built on Web Crypto (available in Workers and
// Node 18+). No database: the admin credential is a PBKDF2 hash stored as a
// Worker Secret, and sessions are stateless HMAC-signed tokens in a cookie.
//
// Trade-off (by design): stateless sessions cannot be revoked before they
// expire; rotate SESSION_SECRET to invalidate all sessions at once.

// Cloudflare Workers' Web Crypto caps PBKDF2 iterations at 100_000, so this is
// the practical maximum here (verified on the edge — higher values throw).
const PBKDF2_ITERATIONS = 100_000;
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

const enc = new TextEncoder();

// ---- base64 / base64url helpers ----------------------------------------

function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function b64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
function b64url(input: Uint8Array | string): string {
  const b64 = typeof input === "string" ? btoa(input) : bytesToB64(input);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecodeToString(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  return atob(b64);
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ---- password hashing (PBKDF2) -----------------------------------------

async function pbkdf2(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    key,
    256,
  );
  return new Uint8Array(bits);
}

/** Produce a storable hash string: `pbkdf2$<iter>$<saltB64>$<hashB64>`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${bytesToB64(salt)}$${bytesToB64(hash)}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations <= 0) return false;
  const salt = b64ToBytes(parts[2]);
  const expected = b64ToBytes(parts[3]);
  const actual = await pbkdf2(password, salt, iterations);
  return constantTimeEqual(actual, expected);
}

// ---- stateless sessions (HMAC-signed) ----------------------------------

export interface SessionPayload {
  sub: string; // username
  exp: number; // unix seconds
}

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

export async function createSession(
  username: string,
  secret: string,
  nowSeconds: number,
  ttlSeconds: number = SESSION_TTL_SECONDS,
): Promise<string> {
  const payload: SessionPayload = { sub: username, exp: nowSeconds + ttlSeconds };
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(await hmac(secret, body));
  return `${body}.${sig}`;
}

export async function verifySession(
  token: string,
  secret: string,
  nowSeconds: number,
): Promise<SessionPayload | null> {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expectedSig = b64url(await hmac(secret, body));
  if (!constantTimeEqual(enc.encode(sig), enc.encode(expectedSig))) return null;
  let payload: SessionPayload;
  try {
    payload = JSON.parse(b64urlDecodeToString(body));
  } catch {
    return null;
  }
  if (typeof payload.exp !== "number" || payload.exp < nowSeconds) return null;
  if (typeof payload.sub !== "string") return null;
  return payload;
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
