import { NextResponse } from "next/server";
import { z } from "zod";
import { registerUser } from "@/lib/auth-service";

const registerSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.email(),
  password: z.string().min(8).max(200),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  await registerUser(parsed.data);
  return NextResponse.json({ ok: true });
}
