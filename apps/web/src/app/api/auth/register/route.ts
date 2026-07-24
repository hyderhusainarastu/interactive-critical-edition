import { isBetaTestingMode } from "@ice/config";
import { NextResponse } from "next/server";
import { z } from "zod";
import { registerUser } from "@/lib/auth-service";
import { clientIdentity, preAuthRateLimit } from "@/lib/preAuthRateLimit";

const registerSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.email(),
  password: z.string().min(8).max(200),
});

export async function POST(request: Request) {
  // Temporary owner-requested beta gate: cheap to check first, before any
  // body parsing. Registration stays closed, but this path is still
  // rate-limited like the normal one — closed doesn't mean unthrottled.
  if (isBetaTestingMode()) {
    const limited = preAuthRateLimit({
      scope: "register-ip",
      identity: clientIdentity(request),
      limit: 10,
      windowMs: 60 * 60_000,
    });
    if (limited) return limited;
    return NextResponse.json(
      { error: "Beta testing is in progress. Registration is closed — contact the site owner for access." },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  // A successful registration inserts a user and sends a verification email;
  // unthrottled this is a mass-account-creation and email-spam vector. Cap per
  // client IP. (Response stays constant for existing emails — enumeration is
  // already handled in `registerUser`.)
  const limited = preAuthRateLimit({
    scope: "register-ip",
    identity: clientIdentity(request),
    limit: 10,
    windowMs: 60 * 60_000,
  });
  if (limited) return limited;

  await registerUser(parsed.data);
  return NextResponse.json({ ok: true });
}
