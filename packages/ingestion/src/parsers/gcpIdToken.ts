import { createSign } from "node:crypto";

/**
 * Mint a Google-signed ID token to call an authenticated Cloud Run service
 * (the private GROBID) from OUTSIDE GCP — the Render worker has no metadata
 * server, so it uses a service-account key via the self-signed JWT bearer
 * grant. No SDK (matches the app's no-vendor-SDK posture): a JWT is RS256-
 * signed with node:crypto and exchanged for an id_token. Cached until ~5 min
 * before expiry. Returns null when GROBID_SA_KEY is unset (local/unauthenticated
 * GROBID), so local dev keeps working with no auth.
 */

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  private_key_id?: string;
  token_uri?: string;
}

let cached: { token: string; exp: number; audience: string } | null = null;

const base64url = (input: Buffer | string) =>
  Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export async function getGoogleIdToken(audience: string): Promise<string | null> {
  const raw = process.env.GROBID_SA_KEY;
  if (!raw) return null;
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.audience === audience && cached.exp - 300 > now) return cached.token;

  let key: ServiceAccountKey;
  try {
    key = JSON.parse(raw) as ServiceAccountKey;
  } catch {
    return null;
  }
  if (!key.client_email || !key.private_key) return null;

  const tokenUri = key.token_uri ?? "https://oauth2.googleapis.com/token";
  const header = { alg: "RS256", typ: "JWT", kid: key.private_key_id };
  const claims = {
    iss: key.client_email,
    sub: key.client_email,
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
    target_audience: audience,
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  const assertion = `${signingInput}.${base64url(signer.sign(key.private_key))}`;

  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!res.ok) throw new Error(`Google token exchange ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { id_token?: string };
  if (!data.id_token) throw new Error("no id_token in Google token response");
  cached = { token: data.id_token, exp: now + 3600, audience };
  return data.id_token;
}
