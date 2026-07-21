import { phase12FeatureEnabled } from "@ice/config";
import { NextResponse } from "next/server";
import { getApiUserId } from "./auth";

/** Writer routes fail closed while the feature flag is off. */
export async function requireWriterApiUser(): Promise<string | NextResponse> {
  if (!phase12FeatureEnabled("writer")) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const userId = await getApiUserId();
  return userId ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export function isWriterApiError(value: string | NextResponse): value is NextResponse {
  return typeof value !== "string";
}
