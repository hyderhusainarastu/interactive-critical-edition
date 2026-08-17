import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createAdminDashCookie, readAdminDashCredentials, verifyAdminDashToken } from "@/lib/admin/adminDash";

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

describe("adminDash token sign/verify", () => {
  // readAdminDashCredentials: any of the three unset -> null (the fail-closed
  // posture requireAdminDash/isAdminDashAuthed build on).
  it("returns null from readAdminDashCredentials when any of the three env vars is unset", () => {
    withEnv({}, () => {
      // "all three unset"
      expect(readAdminDashCredentials()).toBe(null);
    });
    withEnv({ ADMIN_DASH_USERNAME: VALID_ENV.ADMIN_DASH_USERNAME }, () => {
      // "only username set"
      expect(readAdminDashCredentials()).toBe(null);
    });
    withEnv(
      { ADMIN_DASH_USERNAME: VALID_ENV.ADMIN_DASH_USERNAME, ADMIN_DASH_PASSWORD_HASH: VALID_ENV.ADMIN_DASH_PASSWORD_HASH },
      () => {
        // "secret unset"
        expect(readAdminDashCredentials()).toBe(null);
      },
    );
  });

  it("reads the credentials when all three env vars are set", () => {
    withEnv(VALID_ENV, () => {
      const creds = readAdminDashCredentials();
      expect(creds).toBeTruthy();
      expect(creds!.username).toBe(VALID_ENV.ADMIN_DASH_USERNAME);
    });
  });

  // createAdminDashCookie: null when env unset; a well-formed cookie descriptor otherwise.
  it("createAdminDashCookie null when env unset", () => {
    withEnv({}, () => {
      expect(createAdminDashCookie()).toBe(null);
    });
  });

  it("returns a well-formed cookie descriptor when env is set", () => {
    withEnv(VALID_ENV, () => {
      const cookie = createAdminDashCookie();
      expect(cookie).toBeTruthy();
      expect(cookie!.name).toBe("admin_dash");
      expect(cookie!.httpOnly).toBe(true);
      expect(cookie!.sameSite).toBe("lax");
      // "cookie must be scoped to /admin-dash only"
      expect(cookie!.path).toBe("/admin-dash");
      expect(cookie!.maxAge).toBe(12 * 60 * 60);
      // "token has a payload.signature shape"
      expect(cookie!.value.includes(".")).toBeTruthy();
    });
  });

  // verifyAdminDashToken: a token freshly minted under the same env verifies.
  it("a freshly minted, correctly signed token must verify", () => {
    withEnv(VALID_ENV, () => {
      const cookie = createAdminDashCookie();
      expect(verifyAdminDashToken(cookie!.value)).toBeTruthy();
    });
  });

  // env unset at verify time -> false, even for an otherwise-valid token
  // (verifies the fail-closed posture applies to READING too, not just minting).
  it("env unset at verify time must fail closed", () => {
    const token = withEnv(VALID_ENV, () => createAdminDashCookie()!.value);
    withEnv({}, () => {
      expect(verifyAdminDashToken(token)).toBe(false);
    });
  });

  // Missing / malformed input.
  it("rejects missing / malformed input", () => {
    withEnv(VALID_ENV, () => {
      expect(verifyAdminDashToken(null)).toBe(false);
      expect(verifyAdminDashToken(undefined)).toBe(false);
      expect(verifyAdminDashToken("")).toBe(false);
      expect(verifyAdminDashToken("not-two-parts")).toBe(false);
      // "three-part token is malformed, not two"
      expect(verifyAdminDashToken("a.b.c")).toBe(false);
    });
  });

  // Tamper: mutate the payload without re-signing -> signature check fails.
  it("a tampered payload with the OLD signature must fail", () => {
    withEnv(VALID_ENV, () => {
      const cookie = createAdminDashCookie()!;
      const [encodedPayload, signature] = cookie.value.split(".");
      const payload = JSON.parse(Buffer.from(encodedPayload!, "base64url").toString("utf8"));
      const tamperedPayload = Buffer.from(JSON.stringify({ ...payload, u: "someone-else" }), "utf8").toString("base64url");
      const tampered = `${tamperedPayload}.${signature}`;
      expect(verifyAdminDashToken(tampered)).toBe(false);
    });
  });

  // Tamper: mutate the signature itself (same length, different bytes).
  it("a flipped signature byte must fail", () => {
    withEnv(VALID_ENV, () => {
      const cookie = createAdminDashCookie()!;
      const [encodedPayload, signature] = cookie.value.split(".");
      const flipped = signature!
        .split("")
        .map((c, i) => (i === 0 ? (c === "A" ? "B" : "A") : c))
        .join("");
      expect(verifyAdminDashToken(`${encodedPayload}.${flipped}`)).toBe(false);
    });
  });

  // Tamper: a signature of a DIFFERENT length than expected must not throw
  // (the length check must run BEFORE timingSafeEqual, which throws on a
  // length mismatch rather than returning false).
  it("a signature of a different length than expected must not throw", () => {
    withEnv(VALID_ENV, () => {
      const cookie = createAdminDashCookie()!;
      const [encodedPayload] = cookie.value.split(".");
      assert.doesNotThrow(() => verifyAdminDashToken(`${encodedPayload}.short`));
      expect(verifyAdminDashToken(`${encodedPayload}.short`)).toBe(false);
    });
  });

  // Expiry: a payload with exp in the past must fail even with a correct signature.
  it("an expired-but-correctly-signed token must fail", () => {
    withEnv(VALID_ENV, () => {
      const creds = readAdminDashCredentials()!;
      const past = Date.now() - 1000;
      const payload = { v: 1, u: creds.username, iat: past - 1000, exp: past };
      const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
      // Signed the same way adminDash.ts signs internally: HMAC-SHA256 over the
      // encoded payload with the secret.
      const signature = createHmac("sha256", creds.secret).update(encodedPayload).digest("base64url");
      expect(verifyAdminDashToken(`${encodedPayload}.${signature}`)).toBe(false);
    });
  });

  // Version bump: a token signed under an older/different version must fail
  // once the running code's expected version differs from the payload's `v`.
  it("a mismatched token version must fail", () => {
    withEnv(VALID_ENV, () => {
      const creds = readAdminDashCredentials()!;
      const iat = Date.now();
      const payload = { v: 999, u: creds.username, iat, exp: iat + 12 * 60 * 60 * 1000 };
      const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
      const signature = createHmac("sha256", creds.secret).update(encodedPayload).digest("base64url");
      expect(verifyAdminDashToken(`${encodedPayload}.${signature}`)).toBe(false);
    });
  });

  // Username no longer matches env (e.g. ADMIN_DASH_USERNAME rotated) -> a
  // token signed for the OLD username must fail even though its signature and
  // version are otherwise perfectly valid.
  it("username rotation must invalidate outstanding tokens", () => {
    const token = withEnv(VALID_ENV, () => createAdminDashCookie()!.value);
    withEnv({ ...VALID_ENV, ADMIN_DASH_USERNAME: "SomeoneElse" }, () => {
      expect(verifyAdminDashToken(token)).toBe(false);
    });
  });
});
