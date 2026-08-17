/**
 * Workstream E (Ask Library chat upgrade, plan §4): a conversation's display
 * title is derived once, from its first user question — every conversation
 * starts with the DB default `"New conversation"` (see `ragConversations`
 * in `packages/db/src/schema.ts`), and this only ever fires the FIRST time
 * a title is still that default. Once a real title has been set, later
 * turns leave it alone (re-titling a conversation mid-thread would be
 * confusing in the new conversation-switcher list this title now feeds).
 *
 * Truncated to a short, list-friendly length rather than the ~96 chars this
 * logic previously allowed inline in `ragData.ts` — the conversation
 * switcher renders titles in a narrow dropdown row, where a long title just
 * wraps or gets clipped mid-word by CSS `truncate` anyway. Cutting at a
 * word boundary when possible reads better than either.
 */

const DEFAULT_TITLE = "New conversation";
const MAX_TITLE_LENGTH = 60;
// Below this, a word-boundary cut would drop too much of the question to
// stay recognizable in a list row — a hard character cut is more useful.
const MIN_WORD_BOUNDARY_LENGTH = 20;

export function deriveRagConversationTitle(currentTitle: string, question: string): string {
  if (currentTitle !== DEFAULT_TITLE) return currentTitle;
  const trimmed = question.trim();
  if (trimmed.length <= MAX_TITLE_LENGTH) return trimmed;
  const cut = trimmed.slice(0, MAX_TITLE_LENGTH);
  const lastSpace = cut.lastIndexOf(" ");
  const boundary = lastSpace >= MIN_WORD_BOUNDARY_LENGTH ? cut.slice(0, lastSpace) : cut;
  return `${boundary.trimEnd()}…`;
}
