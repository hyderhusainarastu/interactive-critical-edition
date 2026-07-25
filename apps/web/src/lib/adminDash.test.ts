import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createAdminDashCookie, readAdminDashCredentials, verifyAdminDashToken } from "./adminDash";

/**
 * Workstream H (v.5) admin-dash token sign/verify — pure crypto logic, no DB
 * import (same convention as `preAuthRateLimit.test.ts`). This file DOES
 * import `next/headers`/`next/navigation` (for `isAdminDashAuthed`/
 * `requireAdminDash`), but only inside those two functions' own bodies at
 * call time — importing the module itself under plain `tsx` (no Next.js
 * request context) is safe, verified empirically before writing this file.
 * Those two functions themselves aren't exercised here (they need a real
 * request context); `e2e/admin-dash.spec.ts` covers them end-to-end instead.
 *
 * Run: cd apps/web && ../worker/node_modules/.bin/tsx src/lib/adminDash.test.ts
 */

const ENV_KEYS = ["ADMIN_DASH_USERNAME", "ADMIN_DASH_PASSWORD_HASH", "ADMIN_DASH_SECRET"] as const;

function withEnv<T>(overrides: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>, fn: () => T): T {
  const saved: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  for (const key of ENV_KEYS) {
    const value = overrides[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

const VALID_ENV = {
  ADMIN_DASH_USERNAME: "Hyderhusainarastu",
  ADMIN_DASH_PASSWORD_HASH: "$2b$12$notarealhashjustatestvalueXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  ADMIN_DASH_SECRET: "a-test-secret-that-is-at-least-32-bytes-long-xyz",
};

// readAdminDashCredentials: any of the three unset -> null (the fail-closed
// posture requireAdminDash/isAdminDashAuthed build on).
withEnv({}, () => {
  assert.equal(readAdminDashCredentials(), null, "all three unset");
});
withEnv({ ADMIN_DASH_USERNAME: VALID_ENV.ADMIN_DASH_USERNAME }, () => {
  assert.equal(readAdminDashCredentials(), null, "only username set");
});
withEnv(
  { ADMIN_DASH_USERNAME: VALID_ENV.ADMIN_DASH_USERNAME, ADMIN_DASH_PASSWORD_HASH: VALID_ENV.ADMIN_DASH_PASSWORD_HASH },
  () => {
    assert.equal(readAdminDashCredentials(), null, "secret unset");
  },
);
withEnv(VALID_ENV, () => {
  const creds = readAdminDashCredentials();
  assert.ok(creds);
  assert.equal(creds!.username, VALID_ENV.ADMIN_DASH_USERNAME);
});

// createAdminDashCookie: null when env unset; a well-formed cookie descriptor otherwise.
withEnv({}, () => {
  assert.equal(createAdminDashCookie(), null, "createAdminDashCookie null when env unset");
});
withEnv(VALID_ENV, () => {
  const cookie = createAdminDashCookie();
  assert.ok(cookie);
  assert.equal(cookie!.name, "admin_dash");
  assert.equal(cookie!.httpOnly, true);
  assert.equal(cookie!.sameSite, "lax");
  assert.equal(cookie!.path, "/admin-dash", "cookie must be scoped to /admin-dash only");
  assert.equal(cookie!.maxAge, 12 * 60 * 60);
  assert.ok(cookie!.value.includes("."), "token has a payload.signature shape");
});

// verifyAdminDashToken: a token freshly minted under the same env verifies.
withEnv(VALID_ENV, () => {
  const cookie = createAdminDashCookie();
  assert.ok(verifyAdminDashToken(cookie!.value), "a freshly minted, correctly signed token must verify");
});

// env unset at verify time -> false, even for an otherwise-valid token
// (verifies the fail-closed posture applies to READING too, not just minting).
{
  const token = withEnv(VALID_ENV, () => createAdminDashCookie()!.value);
  withEnv({}, () => {
    assert.equal(verifyAdminDashToken(token), false, "env unset at verify time must fail closed");
  });
}

// Missing / malformed input.
withEnv(VALID_ENV, () => {
  assert.equal(verifyAdminDashToken(null), false);
  assert.equal(verifyAdminDashToken(undefined), false);
  assert.equal(verifyAdminDashToken(""), false);
  assert.equal(verifyAdminDashToken("not-two-parts"), false);
  assert.equal(verifyAdminDashToken("a.b.c"), false, "three-part token is malformed, not two");
});

// Tamper: mutate the payload without re-signing -> signature check fails.
withEnv(VALID_ENV, () => {
  const cookie = createAdminDashCookie()!;
  const [encodedPayload, signature] = cookie.value.split(".");
  const payload = JSON.parse(Buffer.from(encodedPayload!, "base64url").toString("utf8"));
  const tamperedPayload = Buffer.from(JSON.stringify({ ...payload, u: "someone-else" }), "utf8").toString("base64url");
  const tampered = `${tamperedPayload}.${signature}`;
  assert.equal(verifyAdminDashToken(tampered), false, "a tampered payload with the OLD signature must fail");
});

// Tamper: mutate the signature itself (same length, different bytes).
withEnv(VALID_ENV, () => {
  const cookie = createAdminDashCookie()!;
  const [encodedPayload, signature] = cookie.value.split(".");
  const flipped = signature!
    .split("")
    .map((c, i) => (i === 0 ? (c === "A" ? "B" : "A") : c))
    .join("");
  assert.equal(verifyAdminDashToken(`${encodedPayload}.${flipped}`), false, "a flipped signature byte must fail");
});

// Tamper: a signature of a DIFFERENT length than expected must not throw
// (the length check must run BEFORE timingSafeEqual, which throws on a
// length mismatch rather than returning false).
withEnv(VALID_ENV, () => {
  const cookie = createAdminDashCookie()!;
  const [encodedPayload] = cookie.value.split(".");
  assert.doesNotThrow(() => verifyAdminDashToken(`${encodedPayload}.short`));
  assert.equal(verifyAdminDashToken(`${encodedPayload}.short`), false);
});

// Expiry: a payload with exp in the past must fail even with a correct signature.
withEnv(VALID_ENV, () => {
  const creds = readAdminDashCredentials()!;
  const past = Date.now() - 1000;
  const payload = { v: 1, u: creds.username, iat: past - 1000, exp: past };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  // Signed the same way adminDash.ts signs internally: HMAC-SHA256 over the
  // encoded payload with the secret.
  const signature = createHmac("sha256", creds.secret).update(encodedPayload).digest("base64url");
  assert.equal(verifyAdminDashToken(`${encodedPayload}.${signature}`), false, "an expired-but-correctly-signed token must fail");
});

// Version bump: a token signed under an older/different version must fail
// once the running code's expected version differs from the payload's `v`.
withEnv(VALID_ENV, () => {
  const creds = readAdminDashCredentials()!;
  const iat = Date.now();
  const payload = { v: 999, u: creds.username, iat, exp: iat + 12 * 60 * 60 * 1000 };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", creds.secret).update(encodedPayload).digest("base64url");
  assert.equal(verifyAdminDashToken(`${encodedPayload}.${signature}`), false, "a mismatched token version must fail");
});

// Username no longer matches env (e.g. ADMIN_DASH_USERNAME rotated) -> a
// token signed for the OLD username must fail even though its signature and
// version are otherwise perfectly valid.
{
  const token = withEnv(VALID_ENV, () => createAdminDashCookie()!.value);
  withEnv({ ...VALID_ENV, ADMIN_DASH_USERNAME: "SomeoneElse" }, () => {
    assert.equal(verifyAdminDashToken(token), false, "username rotation must invalidate outstanding tokens");
  });
}

console.log("adminDash.test.ts: all assertions passed");
