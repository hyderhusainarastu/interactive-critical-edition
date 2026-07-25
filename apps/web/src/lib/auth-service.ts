import { db, passwordResetTokens, users, verificationTokens } from "@ice/db";
import bcrypt from "bcryptjs";
import { and, eq, sql } from "drizzle-orm";
import { mailProvider, passwordResetEmailHtml, verificationEmailHtml } from "@/lib/mail";
import { generateToken, hashToken } from "@/lib/tokens";
import { SITE_NAME } from "@/lib/brand";

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;

function appUrl() {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

export async function registerUser(params: {
  name: string;
  email: string;
  password: string;
  /** Signup consent (Workstream G, v.5): the required policy checkbox.
   *  `registerSchema` requires this to be `true` before it ever reaches
   *  here — see `actions.ts`/`api/auth/register/route.ts` — so this stamps
   *  `policyAcceptedAt` whenever the caller has already validated consent.
   *  Left optional (default `false`) so any other caller of this function
   *  doesn't silently start claiming an acceptance that never happened. */
  policyAccepted?: boolean;
  /** The optional, unchecked-by-default data-sharing opt-in (plan's
   *  "Research data sharing is your choice" — same field the account
   *  profile page's toggle updates later). */
  dataSharingEnabled?: boolean;
}) {
  const email = params.email.toLowerCase();

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  // Silently no-op on an existing email — same outward response as
  // success, so registration can't be used to enumerate accounts.
  if (existing) return;

  const passwordHash = await bcrypt.hash(params.password, 12);
  await db.insert(users).values({
    name: params.name,
    email,
    passwordHash,
    policyAcceptedAt: params.policyAccepted ? new Date() : null,
    dataSharingEnabled: params.dataSharingEnabled ?? false,
  });

  const { raw, hash } = generateToken();
  await db.insert(verificationTokens).values({
    identifier: email,
    token: hash,
    expires: new Date(Date.now() + VERIFICATION_TTL_MS),
  });

  const link = `${appUrl()}/verify-email?token=${raw}&email=${encodeURIComponent(email)}`;
  await mailProvider.send({
    to: email,
    subject: `Verify your email — ${SITE_NAME}`,
    html: verificationEmailHtml(link),
  });
}

export async function verifyEmailToken(rawToken: string, email: string) {
  const normalizedEmail = email.toLowerCase();
  const hash = hashToken(rawToken);

  const [record] = await db
    .select()
    .from(verificationTokens)
    .where(
      and(
        eq(verificationTokens.identifier, normalizedEmail),
        eq(verificationTokens.token, hash),
      ),
    )
    .limit(1);

  if (!record || record.expires < new Date()) return false;

  await db
    .update(users)
    .set({ emailVerified: new Date() })
    .where(eq(users.email, normalizedEmail));

  await db
    .delete(verificationTokens)
    .where(
      and(
        eq(verificationTokens.identifier, normalizedEmail),
        eq(verificationTokens.token, hash),
      ),
    );

  return true;
}

export async function requestPasswordReset(email: string) {
  const normalizedEmail = email.toLowerCase();
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, normalizedEmail))
    .limit(1);

  // No-op (not an error) if the account doesn't exist — the caller
  // always shows the same generic confirmation regardless.
  if (!user) return;

  const { raw, hash } = generateToken();
  await db.insert(passwordResetTokens).values({
    identifier: normalizedEmail,
    token: hash,
    expires: new Date(Date.now() + RESET_TTL_MS),
  });

  const link = `${appUrl()}/reset-password?token=${raw}&email=${encodeURIComponent(normalizedEmail)}`;
  await mailProvider.send({
    to: normalizedEmail,
    subject: `Reset your password — ${SITE_NAME}`,
    html: passwordResetEmailHtml(link),
  });
}

export async function resetPassword(params: {
  email: string;
  token: string;
  password: string;
}) {
  const email = params.email.toLowerCase();
  const hash = hashToken(params.token);

  const [record] = await db
    .select()
    .from(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.identifier, email),
        eq(passwordResetTokens.token, hash),
      ),
    )
    .limit(1);

  if (!record || record.used || record.expires < new Date()) {
    return { ok: false as const, error: "This reset link is invalid or has expired." };
  }

  const passwordHash = await bcrypt.hash(params.password, 12);

  await db
    .update(users)
    .set({ passwordHash, sessionVersion: sql`${users.sessionVersion} + 1` })
    .where(eq(users.email, email));

  await db
    .update(passwordResetTokens)
    .set({ used: true })
    .where(
      and(
        eq(passwordResetTokens.identifier, email),
        eq(passwordResetTokens.token, hash),
      ),
    );

  return { ok: true as const };
}
