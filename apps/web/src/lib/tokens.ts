import { createHash, randomBytes } from "crypto";

/**
 * Tokens are stored hashed (never the raw value) so a database read
 * doesn't hand out usable verification/reset links.
 */
export function generateToken() {
  const raw = randomBytes(32).toString("hex");
  const hash = createHash("sha256").update(raw).digest("hex");
  return { raw, hash };
}

export function hashToken(raw: string) {
  return createHash("sha256").update(raw).digest("hex");
}
