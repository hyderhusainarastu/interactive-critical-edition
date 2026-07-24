"use server";

import { isBetaTestingMode } from "@ice/config";
import { AuthError } from "next-auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getApiUserId, signIn, signOut } from "@/lib/auth";
import { registerUser, requestPasswordReset, resetPassword } from "@/lib/auth-service";
import { clientIdentity, preAuthRateLimit } from "@/lib/preAuthRateLimit";
import { updateUserPreferences } from "@/lib/preferences";
import { setUserReaderLevel } from "@/lib/readerLevel";

const HOUR_MS = 60 * 60_000;

/**
 * Server Actions have no `Request` object the way the sibling API routes
 * under `app/api/auth/*` do, so `clientIdentity` (which only ever reads
 * `request.headers.get(...)`) is fed a minimal shim wrapping the real
 * per-request header list from `next/headers`. This changes no trust
 * logic — it is still the platform-set `x-real-ip` header (or the
 * left-most `x-forwarded-for` hop, or "unknown") that `clientIdentity`
 * itself decides between; only how the headers are obtained differs.
 * NOT exported: Next.js's "use server" file validator only rejects
 * non-async-function *exports* (see `action-validate.js`'s
 * `ensureServerEntryExports`, which iterates the module's exports), so an
 * internal helper like this one is unaffected either way.
 */
async function actionClientIdentity(): Promise<string> {
  const headerList = await headers();
  return clientIdentity({ headers: headerList } as unknown as Request);
}

export async function loginAction(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  try {
    await signIn("credentials", { email, password, redirect: false });
  } catch (error) {
    // Auth.js v5 THROWS when authorize() rejects (it does not return
    // `{ error }`) — including our InvalidCredentialsError /
    // EmailNotVerifiedError. Map any auth failure back to the login form's
    // friendly error state. Non-auth errors — and the NEXT_REDIRECT thrown
    // by redirect() below — must propagate untouched.
    if (error instanceof AuthError) {
      redirect("/login?error=1");
    }
    throw error;
  }

  redirect("/dashboard");
}

export async function logoutAction() {
  await signOut({ redirectTo: "/" });
}

const registerSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.email(),
  password: z.string().min(8).max(200),
});

export async function registerAction(formData: FormData) {
  // Temporary owner-requested beta gate: cheap to check first, before
  // parsing the form. The signup page itself already shows a beta notice
  // instead of the form, but this action still stays rate-limited exactly
  // like the API route above — a closed path isn't an unthrottled one.
  if (isBetaTestingMode()) {
    const limited = preAuthRateLimit({
      scope: "register-ip",
      identity: await actionClientIdentity(),
      limit: 10,
      windowMs: HOUR_MS,
    });
    if (limited) {
      redirect("/signup?error=1");
    }
    redirect("/signup");
  }

  const parsed = registerSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    redirect("/signup?error=1");
  }

  // A successful registration inserts a user and sends a verification
  // email — the same abuse vector the sibling API route
  // (`app/api/auth/register`) already throttles. Mirror it exactly: cap
  // per client IP, and reuse this action's own existing invalid-input
  // error shape (redirect with `?error=1`, a generic message) rather than
  // inventing a new one — the signup page only branches on `error`'s
  // presence, not its value.
  const limited = preAuthRateLimit({
    scope: "register-ip",
    identity: await actionClientIdentity(),
    limit: 10,
    windowMs: HOUR_MS,
  });
  if (limited) {
    redirect("/signup?error=1");
  }

  await registerUser(parsed.data);
  redirect("/verify-email?sent=1");
}

/**
 * Onboarding completion (Phase 6, updated Phase 9.4): records the chosen
 * reader level (`users.readerLevel`, four levels — plan §34.4 9.4, replacing
 * the retired `preferences.expertise`) and stamps `onboardedAt` so the
 * dashboard stops routing the user through /welcome. "Skip" submits with no
 * level chosen but still stamps onboardedAt — an explicit choice is never
 * required. Then sends them to their first upload.
 */
const readerLevelSchema = z.enum(["beginner", "undergraduate", "advanced", "research"]).optional();

export async function completeOnboardingAction(formData: FormData) {
  const userId = await getApiUserId();
  if (!userId) redirect("/login");

  const raw = formData.get("readerLevel");
  const parsed = readerLevelSchema.safeParse(raw === "" || raw == null ? undefined : raw);
  const readerLevel = parsed.success ? parsed.data : undefined;

  if (readerLevel) await setUserReaderLevel(userId, readerLevel);
  await updateUserPreferences(userId, { onboardedAt: new Date().toISOString() });

  redirect(formData.get("skip") ? "/dashboard" : "/upload");
}

export async function requestResetAction(formData: FormData) {
  const email = String(formData.get("email") ?? "");

  if (email) {
    // Each call sends a real email — the same abuse vector the sibling API
    // route (`app/api/auth/request-reset`) already throttles by IP (broad
    // abuse) AND by target email (bombing one victim's inbox). Mirror both
    // limits exactly. Anti-enumeration: this action already redirects to
    // the identical `sent=1` state for an empty email, an unregistered
    // email, and a registered one (see `requestPasswordReset`), so a
    // rate-limited attempt reuses that same existing "skip the send, show
    // the same page" shape rather than a distinct error — a limited
    // response stays indistinguishable from every other case regardless of
    // whether the target email exists.
    const limited = preAuthRateLimit(
      {
        scope: "request-reset-ip",
        identity: await actionClientIdentity(),
        limit: 10,
        windowMs: HOUR_MS,
      },
      {
        scope: "request-reset-email",
        identity: email.toLowerCase(),
        limit: 5,
        windowMs: HOUR_MS,
      },
    );
    if (!limited) {
      await requestPasswordReset(email);
    }
  }

  redirect("/reset-password?sent=1");
}

export async function resetPasswordAction(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");

  // Reset tokens are 256-bit random and single-use, so online brute force
  // is already infeasible on entropy alone; this per-IP cap is defense in
  // depth against a token-guessing flood, mirroring the sibling API route
  // (`app/api/auth/reset-password`) exactly. Reuses this action's own
  // existing "invalid or expired" error redirect shape — the reset page
  // only branches on `error`'s presence, not its value, so a rate-limited
  // attempt looks identical to any other rejected reset.
  const limited = preAuthRateLimit({
    scope: "reset-password-ip",
    identity: await actionClientIdentity(),
    limit: 30,
    windowMs: HOUR_MS,
  });
  if (limited) {
    redirect(
      `/reset-password?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}&error=1`,
    );
  }

  const result = await resetPassword({ email, token, password });
  if (!result.ok) {
    redirect(
      `/reset-password?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}&error=1`,
    );
  }

  redirect("/login?reset=1");
}
