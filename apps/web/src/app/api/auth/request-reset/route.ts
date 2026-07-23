import { NextResponse } from "next/server";
import { z } from "zod";
import { requestPasswordReset } from "@/lib/auth-service";
import { clientIdentity, preAuthRateLimit } from "@/lib/preAuthRateLimit";

const schema = z.object({ email: z.email() });

const HOUR_MS = 60 * 60_000;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  // Each call sends a real email. Throttle by IP (broad abuse) AND by target
  // email (bombing one victim's inbox / burning the owner's mail quota). The
  // per-email check is what actually caps a targeted reset-email flood, since
  // an attacker rotating source IPs would evade the per-IP one alone.
  const limited = preAuthRateLimit(
    { scope: "request-reset-ip", identity: clientIdentity(request), limit: 10, windowMs: HOUR_MS },
    { scope: "request-reset-email", identity: parsed.data.email.toLowerCase(), limit: 5, windowMs: HOUR_MS },
  );
  if (limited) return limited;

  await requestPasswordReset(parsed.data.email);
  return NextResponse.json({ ok: true });
}
