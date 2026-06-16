// Produce an ADMIN_PASSWORD_HASH for the single-admin login, using the same
// PBKDF2 parameters as src/auth.ts. Reads the password from stdin (so it never
// lands in argv / shell history) and prints the storable hash.
//
//   printf '%s' 'my-password' | node scripts/hash-password.mjs
//   # then: echo -n '<hash>' | npx wrangler secret put ADMIN_PASSWORD_HASH

import { webcrypto as crypto } from "node:crypto";

// Must match src/auth.ts. Cloudflare Workers caps PBKDF2 iterations at 100_000.
const ITERATIONS = 100_000;

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data));
  });
}

const password = (await readStdin()).replace(/\r?\n$/, "");
if (!password) {
  console.error("error: empty password (pipe it via stdin)");
  process.exit(1);
}

const enc = new TextEncoder();
const salt = crypto.getRandomValues(new Uint8Array(16));
const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, [
  "deriveBits",
]);
const bits = new Uint8Array(
  await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
    key,
    256,
  ),
);
const b64 = (u) => Buffer.from(u).toString("base64");
console.log(`pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(bits)}`);
