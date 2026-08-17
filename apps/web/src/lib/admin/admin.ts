import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { db, users } from "@ice/db";
import { eq } from "drizzle-orm";

/**
 * Admin gating (plan §20). Admins are an env allowlist (`ADMIN_EMAILS`,
 * comma-separated) rather than a DB role — no schema surface, and admin
 * status can't be self-granted by editing a row. Unset means there are no
 * admins (the admin area 404s for everyone), a safe default.
 */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const allow = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return allow.includes(email.toLowerCase());
}

/**
 * Guards an admin page: requires a session, then confirms the user's email
 * is on the allowlist. Non-admins get a 404 (not a 403) so the admin area's
 * existence isn't revealed — same posture as the rest of the app.
 */
export async function requireAdmin() {
  const session = await requireSession();
  const [row] = await db.select({ email: users.email }).from(users).where(eq(users.id, session.user.id)).limit(1);
  if (!isAdminEmail(row?.email)) notFound();
  return session;
}
