/**
 * Pure function deciding which routes get minimized shell chrome — no
 * marketing-style footer, a slimmer context bar (redesign-shell-spec.md §4,
 * charter §6: "Hide the marketing-style footer and minimize global chrome in
 * Reader, Knowledge Map, and Writer").
 *
 * Deliberately a pure function of `pathname` alone (no separate route-group
 * flag/context to keep in sync) — the spec's own §4 rejected a two-piece
 * (flag + route) design specifically because it can silently drift from the
 * single source of truth, the pathname a page actually rendered at.
 *
 * Matches: the global Knowledge Map (`/graph`), a work-scoped Reader or
 * Knowledge Map (`/works/[workId]/reader`, `/works/[workId]/graph`), and any
 * Writer project (`/writer/[projectId]`). Deliberately does NOT match other
 * work-scoped routes (`/works/[workId]/roadmap`, `/curriculum`,
 * `/diagnostic`) or the bare `/works`/`/works/trash` listings/the bare
 * `/writer` project list — those keep full chrome.
 */
export function isImmersiveRoute(pathname: string): boolean {
  if (pathname === "/graph") return true;
  if (/^\/works\/[^/]+\/(reader|graph)(?:\/|$)/.test(pathname)) return true;
  if (/^\/writer\/[^/]+(?:\/|$)/.test(pathname)) return true;
  return false;
}
