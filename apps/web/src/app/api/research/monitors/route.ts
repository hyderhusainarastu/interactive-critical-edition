import { NextResponse } from "next/server";
import { z } from "zod";
import { createMonitor, listMonitorsForUser } from "@/lib/research/monitors";
import { isResearchApiError, requireMonitoringApiUser } from "@/lib/researchApi";

const createSchema = z.object({
  projectId: z.string().uuid().optional(),
  monitorType: z.enum(["topic", "citation_alert", "author_follow"]),
  query: z.string().trim().min(1).max(500),
  cadence: z.enum(["daily", "weekly", "paused"]).optional(),
});

export async function GET(request: Request) {
  const userId = await requireMonitoringApiUser();
  if (isResearchApiError(userId)) return userId;
  const projectId = new URL(request.url).searchParams.get("projectId") ?? undefined;
  return NextResponse.json({ monitors: await listMonitorsForUser(userId, projectId) });
}

export async function POST(request: Request) {
  const userId = await requireMonitoringApiUser();
  if (isResearchApiError(userId)) return userId;
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid monitor." }, { status: 400 });

  const result = await createMonitor(userId, parsed.data);
  if (result.action === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ monitor: result.monitor }, { status: 201 });
}
