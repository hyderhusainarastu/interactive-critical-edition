import { NextResponse } from "next/server";
import { ADMIN_DASH_COOKIE_NAME } from "@/lib/adminDash";

/** Clears the admin-dash session cookie and returns to the login page. No
 *  auth check needed here — logging out an already-signed-out browser is a
 *  no-op, not a security-relevant action. */
export async function POST(request: Request) {
  const response = NextResponse.redirect(new URL("/admin-dash/login", request.url), 303);
  response.cookies.set({
    name: ADMIN_DASH_COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/admin-dash",
    maxAge: 0,
  });
  return response;
}
