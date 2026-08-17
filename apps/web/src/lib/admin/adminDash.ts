import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";

/**
 * Workstream H (v.5): auth for the separate, credential-gated `/admin-dash`
 * dashboard — deliberately independent of the existing `/admin` area
 * (`lib/admin.ts`, `ADMIN_EMAILS` + a real user session) and of `@/lib/auth`
 * entirely (zero imports from it, by design — this must keep working even
 * for an operator with no Palimnote account at all, and must never be
 * reachable by escalating a normal session).
 *
 * Token shape: `base64url(payload).base64url(hmacSHA256(payload, secret))`,
 * hand-rolled over Node's own `crypto` rather than a JWT library — the
 * payload is four fields and the verification the plan actually needs
 * (signature, expiry, version, username) doesn't need a spec-compliant JOSE
 * implementation. `exp` lives INSIDE the signed payload (not as a separate
 * cookie attribute) so it can never be extended by anything other than
 * minting a fresh, correctly-signed token.
 *
 * Fail-closed by construction: `readCredentials()` returns null the moment
 * ANY of the three required env vars is unset, and every exported check
 * here treats that the same as "not authenticated" — so shipping this
 * lane's code before the three env vars are configured in a given
 * environment is safe (the whole `/admin-dash` tree just 404s there, same
 * as if the route didn't exist).
 */

export const ADMIN_DASH_COOKIE_NAME = "admin_dash";

/** Bumping this invalidates every outstanding token immediately (same lever
 *  as rotating ADMIN_DASH_SECRET), without needing a server-side session
 *  store — a token whose `v` doesn't match is rejected regardless of an
 *  otherwise-valid signature. */
const TOKEN_VERSION = 1;

const SESSION_MS = 12 * 60 * 60 * 1000;

interface AdminDashPayload {
  v: number;
  u: string;
  iat: number;
  exp: number;
}

interface AdminDashCredentials {
  username: string;
  passwordHash: string;
  secret: string;
}

/**
 * The single source of truth for "is admin-dash configured at all" — every
 * other function in this module funnels through this, so a missing env var
 * has exactly one place it's checked rather than three chances to forget.
 */
export function readAdminDashCredentials(): AdminDashCredentials | null {
  const username = process.env.ADMIN_DASH_USERNAME;
  const passwordHash = process.env.ADMIN_DASH_PASSWORD_HASH;
  const secret = process.env.ADMIN_DASH_SECRET;
  if (!username || !passwordHash || !secret) return null;
  return { username, passwordHash, secret };
}

function sign(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

function encodePayload(payload: AdminDashPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodePayload(encoded: string): AdminDashPayload | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as AdminDashPayload).v !== "number" ||
      typeof (parsed as AdminDashPayload).u !== "string" ||
      typeof (parsed as AdminDashPayload).iat !== "number" ||
      typeof (parsed as AdminDashPayload).exp !== "number"
    ) {
      return null;
    }
    return parsed as AdminDashPayload;
  } catch {
    return null;
  }
}

export interface AdminDashCookie {
  name: string;
  value: string;
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: string;
  maxAge: number;
}

/**
 * Mints a fresh signed token and the cookie descriptor to set it —
 * `httpOnly` always, `secure` only outside local dev (a plain-HTTP
 * localhost would never receive a `Secure` cookie back), `sameSite: lax`,
 * and — the pitfall the plan calls out explicitly — `path: "/admin-dash"`
 * so the browser never even attaches this cookie to a request for the rest
 * of the app. Returns null when the env isn't fully configured, so a caller
 * (the login route) never mints a token no `verifyAdminDashToken` call
 * could ever validate.
 */
export function createAdminDashCookie(): AdminDashCookie | null {
  const credentials = readAdminDashCredentials();
  if (!credentials) return null;
  const iat = Date.now();
  const payload: AdminDashPayload = { v: TOKEN_VERSION, u: credentials.username, iat, exp: iat + SESSION_MS };
  const encodedPayload = encodePayload(payload);
  const token = `${encodedPayload}.${sign(encodedPayload, credentials.secret)}`;
  return {
    name: ADMIN_DASH_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/admin-dash",
    maxAge: Math.floor(SESSION_MS / 1000),
  };
}

/**
 * Verifies a raw `admin_dash` cookie value. Order matters (plan §H):
 * env fully configured → well-formed two-part token → timing-safe signature
 * comparison (length-checked FIRST, since `timingSafeEqual` throws rather
 * than returning false on a length mismatch — an attacker-controlled cookie
 * value must never be able to trigger that throw path) → not expired →
 * expected token version → the signed username still matches the current
 * env value (so rotating `ADMIN_DASH_USERNAME` invalidates every
 * outstanding token immediately, same as rotating the secret).
 */
export function verifyAdminDashToken(token: string | null | undefined): boolean {
  if (!token) return false;
  const credentials = readAdminDashCredentials();
  if (!credentials) return false;

  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [encodedPayload, signature] = parts;
  if (!encodedPayload || !signature) return false;

  let signatureBuf: Buffer;
  let expectedBuf: Buffer;
  try {
    signatureBuf = Buffer.from(signature, "base64url");
    expectedBuf = Buffer.from(sign(encodedPayload, credentials.secret), "base64url");
  } catch {
    return false;
  }
  if (signatureBuf.length !== expectedBuf.length) return false;
  if (!timingSafeEqual(signatureBuf, expectedBuf)) return false;

  const payload = decodePayload(encodedPayload);
  if (!payload) return false;
  if (Date.now() >= payload.exp) return false;
  if (payload.v !== TOKEN_VERSION) return false;
  if (payload.u !== credentials.username) return false;

  return true;
}

/** Reads and verifies the cookie from the current request. Never throws;
 *  returns false for any failure shape (missing cookie, tampered token,
 *  expired, unconfigured env). */
export async function isAdminDashAuthed(): Promise<boolean> {
  const store = await cookies();
  return verifyAdminDashToken(store.get(ADMIN_DASH_COOKIE_NAME)?.value);
}

/**
 * Guards a Server Component. Called from BOTH the `(dash)` layout AND every
 * individual page under it (belt-and-braces per the plan — there is no
 * middleware in this repo, so this is the only enforcement point, and a
 * future page that forgets to nest under the guarded layout still 404s on
 * its own). `notFound()` — never a 401/redirect-to-login — so the existence
 * of this whole area is never revealed to an unauthenticated caller, same
 * posture as `requireAdmin()` in `lib/admin.ts`.
 */
export async function requireAdminDash(): Promise<void> {
  if (!(await isAdminDashAuthed())) notFound();
}
