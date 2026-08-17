import { NextResponse } from "next/server";
import { z } from "zod";
import { isApiAuthError, requireApiUser } from "@/lib/api/apiAuth";
import { getWorkspacePreferences, updateWorkspacePreferences } from "@/lib/auth/preferences";

const preferencesSchema = z.object({
  theme: z.enum(["system", "light", "dark"]).optional(),
  fontSize: z.enum(["small", "medium", "large"]).optional(),
  readingWidth: z.enum(["compact", "comfortable", "wide"]).optional(),
  focusMode: z.boolean().optional(),
  scriptDisplay: z.enum(["original", "transliteration"]).optional(),
  soundEnabled: z.boolean().optional(),
  motionEnabled: z.boolean().optional(),
}).strict();

export async function GET() {
  const userId = await requireApiUser();
  if (isApiAuthError(userId)) return userId;
  return NextResponse.json({ preferences: await getWorkspacePreferences(userId) });
}

export async function PUT(request: Request) {
  const userId = await requireApiUser();
  if (isApiAuthError(userId)) return userId;

  const parsed = preferencesSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: "Invalid preference update" }, { status: 400 });
  }

  return NextResponse.json({ preferences: await updateWorkspacePreferences(userId, parsed.data) });
}
