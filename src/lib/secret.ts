/**
 * Encrypted credential envelope shared by the server (MCP `seal_secret` /
 * `reveal_secret`, the http fallback route) and the browser (click-to-reveal
 * on a ```secret block). Only WebCrypto + TextEncoder + btoa/atob are used so
 * the same file compiles under both tsconfigs and runs in both runtimes.
 *
 * Scheme: passphrase → PBKDF2-HMAC-SHA256 (random 16-byte salt) → AES-256-GCM
 * (random 12-byte IV). GCM authenticates, so a wrong key or an edited
 * ciphertext fails loudly instead of producing garbage.
 */
export const SECRET_VERSION = 1;
/** OWASP's 2023 floor for PBKDF2-HMAC-SHA256. ~0.3 s in a browser. */
export const SECRET_ITERATIONS = 600_000;

export interface SecretEnvelope {
  v: 1;
  /** Shown on the button — what the secret IS, not the secret. */
  label?: string;
  /** Reminder of which key unlocks it, shown next to the key prompt. */
  hint?: string;
  iter: number;
  salt: string;
  iv: string;
  ct: string;
}

const B64 = /^[A-Za-z0-9+/]+=*$/;

// Derived structurally so the file typechecks under both the Node lib
// (no DOM globals) and the browser lib.
type Subtle = typeof globalThis.crypto.subtle;
type Key = Awaited<ReturnType<Subtle["importKey"]>>;

function toB64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function subtle(): Subtle {
  const c = globalThis.crypto;
  if (!c || !c.subtle) {
    throw new Error("WebCrypto unavailable — needs a secure context (https or localhost)");
  }
  return c.subtle;
}

async function deriveKey(key: string, salt: Uint8Array<ArrayBuffer>, iter: number): Promise<Key> {
  const s = subtle();
  const material = await s.importKey("raw", new TextEncoder().encode(key), "PBKDF2", false, [
    "deriveKey",
  ]);
  return s.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: iter },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function sealSecret(
  text: string,
  key: string,
  opts: { label?: string; hint?: string } = {},
): Promise<SecretEnvelope> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aes = await deriveKey(key, salt, SECRET_ITERATIONS);
  const ct = await subtle().encrypt({ name: "AES-GCM", iv }, aes, new TextEncoder().encode(text));
  return {
    v: SECRET_VERSION,
    ...(opts.label ? { label: opts.label } : {}),
    ...(opts.hint ? { hint: opts.hint } : {}),
    iter: SECRET_ITERATIONS,
    salt: toB64(salt),
    iv: toB64(iv),
    ct: toB64(new Uint8Array(ct)),
  };
}

export async function unsealSecret(env: SecretEnvelope, key: string): Promise<string> {
  const aes = await deriveKey(key, fromB64(env.salt), env.iter);
  let plain: ArrayBuffer;
  try {
    plain = await subtle().decrypt({ name: "AES-GCM", iv: fromB64(env.iv) }, aes, fromB64(env.ct));
  } catch {
    throw new Error("decrypt failed: wrong key or tampered ciphertext");
  }
  return new TextDecoder().decode(plain);
}

/** Validate a fence body. Throws with a message naming what is wrong. */
export function parseSecretEnvelope(body: string): SecretEnvelope {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    throw new Error("secret body is not valid JSON");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("secret body must be a JSON object");
  }
  const o = raw as Record<string, unknown>;
  if (o.v !== SECRET_VERSION) throw new Error(`unsupported secret version: ${String(o.v)}`);
  for (const f of ["salt", "iv", "ct"] as const) {
    if (typeof o[f] !== "string" || !o[f]) throw new Error(`secret is missing "${f}"`);
    if (!B64.test(o[f] as string)) throw new Error(`secret "${f}" is not base64`);
  }
  const iter =
    typeof o.iter === "number" && Number.isInteger(o.iter) && o.iter > 0 ? o.iter : SECRET_ITERATIONS;
  return {
    v: SECRET_VERSION,
    ...(typeof o.label === "string" && o.label ? { label: o.label } : {}),
    ...(typeof o.hint === "string" && o.hint ? { hint: o.hint } : {}),
    iter,
    salt: o.salt as string,
    iv: o.iv as string,
    ct: o.ct as string,
  };
}

export function formatSecretFence(env: SecretEnvelope): string {
  return "```secret\n" + JSON.stringify(env) + "\n```";
}
