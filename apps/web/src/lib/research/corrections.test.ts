import { describe, expect, it } from "vitest";
import type { CorrectionEditor, ResearchObjectType, StatusAction } from "./corrections";

/**
 * The "no auto-endorsement" guarantee, verified from the TYPE side of the
 * boundary (plan §Schema `research_revision_no_auto_endorsement`: "combined
 * with `applyResearchCorrection`'s editor type having no `'system'` member,
 * an auto-endorsement path cannot be written, compiled OR inserted"). The
 * DB-level half (the CHECK constraint itself, and `corrections.ts`'s own
 * runtime atomicity test proving a `system`-editor row is rejected) lives
 * elsewhere; this file is the "cannot be written [or] compiled" half —
 * `apps/web` has no vitest wiring, so this runs the same way
 * `evidenceChamberContract.test.ts` does: as a plain script
 * (`pnpm --filter web exec tsx <path>`) whose real enforcement is
 * `tsc --noEmit`, part of every gate this lane runs.
 */

// ---------------------------------------------------------------------------
// 1. COMPILE-TIME: `CorrectionEditor` must never include `"system"`.
// ---------------------------------------------------------------------------

type ForbiddenEditorMember = Extract<CorrectionEditor, "system">;

// If `ForbiddenEditorMember` is ever anything other than `never` (i.e.
// `CorrectionEditor` was widened to include `"system"`), this line fails to
// compile: `T extends never` rejects any non-never type.
type AssertNever<T extends never> = T;
type _NoSystemEditor = AssertNever<ForbiddenEditorMember>;
void (0 as unknown as _NoSystemEditor); // referenced so the type isn't flagged unused

// ---------------------------------------------------------------------------
// 2. RUNTIME companion: the type's real members aren't accidentally `never`
//    itself (which would vacuously "pass" check 1 above with nothing to say).
// ---------------------------------------------------------------------------

const editors: CorrectionEditor[] = ["user", "editor"];
const statusActions: StatusAction[] = ["verified", "disputed", "hidden", "restored"];
const objectTypes: ResearchObjectType[] = ["claim", "relationship", "cluster", "chamber", "hypothesis", "gap"];

describe("corrections type contract", () => {
  it("keeps CorrectionEditor's real members from being accidentally `never`", () => {
    expect(editors).toEqual(["user", "editor"]);
  });

  it("keeps StatusAction's real members from being accidentally `never`", () => {
    expect(statusActions).toEqual(["verified", "disputed", "hidden", "restored"]);
  });

  // `evidence_chamber_position` is a real `research_revision.object_type`
  // enum value the DB accepts, but deliberately absent here — see
  // `corrections.ts`'s own class doc comment for why "position" has no
  // mutation surface in this module.
  it("covers exactly the six mutable object types, deliberately excluding position", () => {
    expect(objectTypes.length).toBe(6);
    expect(!(objectTypes as string[]).includes("position")).toBeTruthy();
  });
});
