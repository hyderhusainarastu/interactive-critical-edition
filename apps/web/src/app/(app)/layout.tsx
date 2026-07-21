import { db, users } from "@ice/db";
import { eq } from "drizzle-orm";
import { requireSession } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { getWorkspacePreferences } from "@/lib/preferences";
import { AppShell } from "@/components/app/AppShell";
import { PreferenceBootstrap } from "@/components/app/PreferenceBootstrap";
import { phase12FeatureEnabled } from "@ice/config";

/**
 * Single, centralized auth check for every route under (app) — replaces
 * the Phase 1 pattern of checking auth() in each page individually,
 * per the "revisit once Phase 2 adds more protected pages" note in
 * docs/PROJECT-LOG.md. Still Node-runtime (not Edge middleware) since the
 * sessionVersion revocation check needs postgres.js.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();
  const [me] = await db.select({ email: users.email }).from(users).where(eq(users.id, session.user.id)).limit(1);
  const admin = isAdminEmail(me?.email);
  const preferences = await getWorkspacePreferences(session.user.id);

  return (
    <>
      <PreferenceBootstrap fallbackPreferences={preferences} />
      <AppShell email={session.user.email} admin={admin} writerEnabled={phase12FeatureEnabled("writer")} initialPreferences={preferences}>{children}</AppShell>
    </>
  );
}
