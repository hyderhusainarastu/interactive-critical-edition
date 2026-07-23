import { NextResponse } from "next/server";
import { z } from "zod";
import { resetPassword } from "@/lib/auth-service";
import { clientIdentity, preAuthRateLimit } from "@/lib/preAuthRateLimit";

const schema = z.object({
  email: z.email(),
  token: z.string().min(1),
  password: z.string().min(8).max(200),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  // Reset tokens are 256-bit random and single-use, so online brute force is
  // already infeasible on entropy alone; this per-IP cap is defense in depth
  // against a token-guessing flood rather than the primary control.
  const limited = preAuthRateLimit({
    scope: "reset-password-ip",
    identity: clientIdentity(request),
    limit: 30,
    windowMs: 60 * 60_000,
  });
  if (limited) return limited;

  const result = await resetPassword(parsed.data);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
