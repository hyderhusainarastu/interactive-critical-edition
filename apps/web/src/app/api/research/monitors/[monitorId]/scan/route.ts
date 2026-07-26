import { NextResponse } from "next/server";
import { dispatchScanMonitorJob } from "@/lib/research/monitors";
import { isResearchApiError, requireMonitoringApiUser } from "@/lib/researchApi";

/** The "Scan now" action — dispatches a `run_monitor` job scoped to exactly
 *  this one monitor, regardless of whether its cadence says it's due yet
 *  (`runMonitorForScope`'s own doc comment: an explicit action always runs). */
export async function POST(_request: Request, { params }: { params: Promise<{ monitorId: string }> }) {
  const userId = await requireMonitoringApiUser();
  if (isResearchApiError(userId)) return userId;
  const { monitorId } = await params;
  const result = await dispatchScanMonitorJob(userId, monitorId);
  if (result.action === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(result);
}
