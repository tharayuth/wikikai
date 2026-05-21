import crypto from "node:crypto";

/**
 * Password hashing using Node's built-in `crypto.scrypt` — no extra
 * dependency, OWASP-recommended KDF for password storage. Format on
 * disk: `scrypt$<salt-hex>$<hash-hex>` so we can rotate algorithms
 * later by adding a new prefix.
 *
 * Parameters: N=2^15 (16384), r=8, p=1, derived key 64 bytes. Same
 * defaults Node's docs recommend for interactive logins.
 */
const SCRYPT_KEYLEN = 64;
const SCRYPT_COST = 16384; // N
const SCRYPT_BLOCK = 8; // r
const SCRYPT_PARALLEL = 1; // p

export function hashPassword(password: string): string {
  if (typeof password !== "string" || password.length === 0) {
    throw new Error("password is required");
  }
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto
    .scryptSync(password, salt, SCRYPT_KEYLEN, {
      N: SCRYPT_COST,
      r: SCRYPT_BLOCK,
      p: SCRYPT_PARALLEL,
    })
    .toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, salt, hashHex] = parts;
  let candidate: Buffer;
  try {
    candidate = crypto.scryptSync(password, salt, SCRYPT_KEYLEN, {
      N: SCRYPT_COST,
      r: SCRYPT_BLOCK,
      p: SCRYPT_PARALLEL,
    });
  } catch {
    return false;
  }
  const stored_buf = Buffer.from(hashHex, "hex");
  if (stored_buf.length !== candidate.length) return false;
  return crypto.timingSafeEqual(stored_buf, candidate);
}

/** Generate an opaque session token (32 random bytes, base64url-encoded). */
export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}
