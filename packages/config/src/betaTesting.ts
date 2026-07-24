/**
 * Temporary owner-requested beta gate (2026-07-23): while enabled, blocks
 * new-account registration and surfaces a "Beta testing" badge/notice across
 * the app. Additive local-release flag, same contract as `phase18RagEnabled`
 * — defaults off so a code push cannot itself close registration. Remove
 * this file and its call sites once the beta period ends.
 */
export function isBetaTestingMode(env: Record<string, string | undefined> = process.env): boolean {
  const raw = env.BETA_TESTING_MODE?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}
