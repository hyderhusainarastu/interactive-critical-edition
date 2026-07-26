import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteMonitor, getOwnedMonitor, updateMonitor } from "@/lib/research/monitors";
import { isResearchApiError, requireMonitoringApiUser } from "@/lib/researchApi";

const patchSchema = z
  .object({
    query: z.string().trim().min(1).max(500).optional(),
    cadence: z.enum(["daily", "weekly", "paused"]).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((input) => Object.keys(input).length > 0, { message: "Nothing to update." });

export async function GET(_request: Request, { params }: { params: Promise<{ monitorId: string }> }) {
  const userId = await requireMonitoringApiUser();
  if (isResearchApiError(userId)) return userId;
  const { monitorId } = await params;
  const monitor = await getOwnedMonitor(userId, monitorId);
  return monitor ? NextResponse.json({ monitor }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ monitorId: string }> }) {
  const userId = await requireMonitoringApiUser();
  if (isResearchApiError(userId)) return userId;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid monitor update." }, { status: 400 });
  const { monitorId } = await params;
  const updated = await updateMonitor(userId, monitorId, parsed.data);
  return updated ? NextResponse.json({ monitor: updated }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ monitorId: string }> }) {
  const userId = await requireMonitoringApiUser();
  if (isResearchApiError(userId)) return userId;
  const { monitorId } = await params;
  const deleted = await deleteMonitor(userId, monitorId);
  return deleted ? NextResponse.json({ deleted: true }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}
