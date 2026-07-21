import { NextResponse } from "next/server";
import { z } from "zod";
import { READER_LEVELS } from "@ice/roadmap";
import { getApiUserId } from "@/lib/auth";
import { setUserReaderLevel } from "@/lib/readerLevel";

/**
 * Accepts an explicit reader-level change (plan §35.2's suggested-level
 * nudge, and any other reader-facing "set my level" control). This is
 * always an explicit choice — the nudge only ever calls this when the
 * reader clicks "Switch", never automatically, matching the plan's
 * "browsing alone never silently changes a level" rule already enforced
 * for the page-local level filters on Roadmap/Curriculum/Library.
 */
const schema = z.object({
  level: z.enum(READER_LEVELS as [string, ...string[]]),
});

export async function POST(request: Request) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  await setUserReaderLevel(userId, parsed.data.level as (typeof READER_LEVELS)[number]);
  return NextResponse.json({ ok: true });
}
