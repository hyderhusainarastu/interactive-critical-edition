import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { getV4BackfillForecast } from "@/lib/v4Backfill";

/** Admin-only, no-side-effect preview required before a paid v4 backfill. */
export async function GET() {
  await requireAdmin();
  return NextResponse.json(await getV4BackfillForecast());
}
