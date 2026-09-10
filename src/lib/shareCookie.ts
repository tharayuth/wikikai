import crypto from "node:crypto";

/**
 * Stateless login cookie for password-protected share links.
 *
 * Value: `<shareUserId>.<expiresMs>.<hmac>` where the HMAC key is the share
 * user's stored password hash. That choice is what keeps the design small:
 * there is no session table and no server secret to configure, yet the
 * cookie dies on its own whenever the user is deleted (no hash to verify
 * against), the link is rotated (cookie name carries the token), or the
 * expiry passes. Verification is constant-time on the signature.
 */
const SEP = ".";

function sign(userId: number, exp: number, key: string): string {
  return crypto
    .createHmac("sha256", key)
    .update(`${userId}${SEP}${exp}`)
    .digest("base64url");
}

export function signShareCookie(userId: number, exp: number, key: string): string {
  return `${userId}${SEP}${exp}${SEP}${sign(userId, exp, key)}`;
}

/** Parse the id out of a cookie without trusting it — the caller needs it
 *  to look up the key before `verifyShareCookie` can run. */
export function peekShareCookieUserId(value: string): number | null {
  const id = Number(value.split(SEP)[0]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function verifyShareCookie(
  value: string,
  key: string,
): { userId: number; exp: number } | null {
  const parts = value.split(SEP);
  if (parts.length !== 3) return null;
  const userId = Number(parts[0]);
  const exp = Number(parts[1]);
  if (!Number.isInteger(userId) || !Number.isFinite(exp)) return null;
  if (exp <= Date.now()) return null;
  const expected = Buffer.from(sign(userId, exp, key));
  const given = Buffer.from(parts[2]);
  if (expected.length !== given.length) return null;
  if (!crypto.timingSafeEqual(expected, given)) return null;
  return { userId, exp };
}
