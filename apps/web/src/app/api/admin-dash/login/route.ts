import { createHash, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { createAdminDashCookie, readAdminDashCredentials } from "@/lib/adminDash";
import { clientIdentity, preAuthRateLimit } from "@/lib/preAuthRateLimit";

/**
 * Workstream H (v.5) admin-dash login. A plain `<form method="POST">` (see
 * `admin-dash/login/page.tsx`) rather than a client-side fetch — this
 * surface deliberately stays as simple/inspectable as possible.
 *
 * Timing-uniform by construction (plan §H pitfall list): `bcrypt.compare`
 * AND the username check both run unconditionally, on every request,
 * regardless of which one is obviously wrong — an attacker probing for a
 * valid username by timing alone learns nothing, since a wrong username and
 * a wrong password take exactly the same code path. The username itself is
 * compared as SHA-256 digests via `timingSafeEqual` rather than `===`
 * (which short-circuits on the first differing byte, and would throw on
 * `timingSafeEqual` directly given two different-length raw strings) —
 * hashing first normalizes both sides to a fixed 32 bytes.
 */
export async function POST(request: Request) {
  const limited = preAuthRateLimit({
    scope: "admin-dash-login-ip",
    identity: clientIdentity(request),
    limit: 5,
    windowMs: 15 * 60_000,
  });
  if (limited) return limited;

  const form = await request.formData().catch(() => null);
  const submittedUsername = typeof form?.get("username") === "string" ? String(form.get("username")) : "";
  // Never logged, never included in any error response or telemetry call —
  // this local variable is the only place it exists past this function.
  const submittedPassword = typeof form?.get("password") === "string" ? String(form.get("password")) : "";

  const credentials = readAdminDashCredentials();
  const loginUrl = new URL("/admin-dash/login", request.url);

  if (!credentials) {
    // Env not configured — every page under /admin-dash already 404s; fail
    // this POST the same honest, generic way rather than a misleading 500.
    loginUrl.searchParams.set("error", "1");
    return NextResponse.redirect(loginUrl, 303);
  }

  const passwordMatches = await bcrypt.compare(submittedPassword, credentials.passwordHash);
  const submittedUsernameDigest = createHash("sha256").update(submittedUsername).digest();
  const expectedUsernameDigest = createHash("sha256").update(credentials.username).digest();
  const usernameMatches = timingSafeEqual(submittedUsernameDigest, expectedUsernameDigest);

  if (!passwordMatches || !usernameMatches) {
    loginUrl.searchParams.set("error", "1");
    return NextResponse.redirect(loginUrl, 303);
  }

  const cookie = createAdminDashCookie();
  if (!cookie) {
    loginUrl.searchParams.set("error", "1");
    return NextResponse.redirect(loginUrl, 303);
  }

  const response = NextResponse.redirect(new URL("/admin-dash", request.url), 303);
  response.cookies.set(cookie);
  return response;
}
