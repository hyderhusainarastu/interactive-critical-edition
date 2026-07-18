import { NextResponse } from "next/server";
import { verifyEmailToken } from "@/lib/auth-service";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");
  const email = searchParams.get("email");
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  if (!token || !email) {
    return NextResponse.redirect(`${appUrl}/verify-email?error=missing`);
  }

  const verified = await verifyEmailToken(token, email);
  return NextResponse.redirect(
    verified
      ? `${appUrl}/login?verified=1`
      : `${appUrl}/verify-email?error=invalid`,
  );
}
