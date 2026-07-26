import { db, users } from "@ice/db";
import { eq } from "drizzle-orm";
import { requireSession } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { getWorkspacePreferences } from "@/lib/preferences";
import { getUserReaderLevel } from "@/lib/readerLevel";
import { AppShell } from "@/components/app/AppShell";
import { PreferenceBootstrap } from "@/components/app/PreferenceBootstrap";
import { TelemetryBeacon } from "@/components/app/TelemetryBeacon";
import { phase12FeatureEnabled, phase18RagEnabled, phase25FeatureEnabled } from "@ice/config";

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
  const [me] = await db.select({ email: users.email, name: users.name, image: users.image }).from(users).where(eq(users.id, session.user.id)).limit(1);
  const admin = isAdminEmail(me?.email);
  const preferences = await getWorkspacePreferences(session.user.id);
  const readerLevel = await getUserReaderLevel(session.user.id);

  return (
    <>
      <PreferenceBootstrap fallbackPreferences={preferences} />
      <TelemetryBeacon />
      <AppShell userId={session.user.id} email={session.user.email} name={me?.name} image={me?.image} admin={admin} writerEnabled={phase12FeatureEnabled("writer")} ragEnabled={phase18RagEnabled()} researchEnabled={phase25FeatureEnabled("research")} initialPreferences={preferences} initialReaderLevel={readerLevel}>{children}</AppShell>
    </>
  );
}
