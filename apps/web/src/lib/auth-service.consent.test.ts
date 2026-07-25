import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db, users } from "@ice/db";
import { registerUser } from "./auth-service";

/**
 * Workstream G (v.5) signup-consent contract, at the service layer
 * `registerAction`/the JSON `api/auth/register` route both funnel through
 * (see the plan's "registerAction consent contract... at the action/service
 * layer" instruction). Real DB writes + cleanup, same convention as
 * `competencyData.test.ts`:
 *
 *   cd apps/web && DATABASE_URL=postgres://ice:ice_dev_only@localhost:5432/interactive_critical_edition \
 *     ../worker/node_modules/.bin/tsx src/lib/auth-service.consent.test.ts
 *
 * This intentionally does NOT drive `registerAction` itself — that "use
 * server" function calls `next/navigation`'s `redirect()`, which throws
 * unconditionally (success and failure alike) outside a real Next.js
 * request, making it an awkward and fragile thing to invoke from a plain
 * script. `registerUser` is the actual data-persisting logic both the
 * action and the API route call after their own consent-schema validation
 * passes, so it's the honest place to verify the contract: given consent
 * was accepted, the account row records it truthfully.
 */

const EMAIL_ACCEPTED = `e2e-consent-accepted-${Date.now()}@example.test`;
const EMAIL_SHARING = `e2e-consent-sharing-${Date.now()}@example.test`;
const EMAIL_DEFAULT = `e2e-consent-default-${Date.now()}@example.test`;

async function cleanup(email: string) {
  await db.delete(users).where(eq(users.email, email));
}

async function main() {
  try {
    await registerUser({ name: "Consent Tester", email: EMAIL_ACCEPTED, password: "password123", policyAccepted: true, dataSharingEnabled: false });
    const [accepted] = await db.select().from(users).where(eq(users.email, EMAIL_ACCEPTED)).limit(1);
    assert.ok(accepted, "user row should exist");
    assert.ok(accepted!.policyAcceptedAt !== null, "policyAcceptedAt must be stamped when policyAccepted is true");
    assert.equal(accepted!.dataSharingEnabled, false, "data sharing stays off when not opted in");

    await registerUser({ name: "Sharing Tester", email: EMAIL_SHARING, password: "password123", policyAccepted: true, dataSharingEnabled: true });
    const [sharing] = await db.select().from(users).where(eq(users.email, EMAIL_SHARING)).limit(1);
    assert.equal(sharing!.dataSharingEnabled, true, "data sharing persists true when explicitly opted in");
    assert.ok(sharing!.policyAcceptedAt !== null);

    // A caller that never passes consent (e.g. a stale internal call site)
    // must never silently backdate an acceptance that didn't happen —
    // policyAcceptedAt stays null and dataSharingEnabled defaults to the
    // schema's own off default, exactly like a pre-checkbox account.
    await registerUser({ name: "Default Tester", email: EMAIL_DEFAULT, password: "password123" });
    const [defaulted] = await db.select().from(users).where(eq(users.email, EMAIL_DEFAULT)).limit(1);
    assert.equal(defaulted!.policyAcceptedAt, null, "no consent passed means no acceptance is recorded");
    assert.equal(defaulted!.dataSharingEnabled, false);

    console.log("auth-service.consent.test.ts: all assertions passed");
  } finally {
    await cleanup(EMAIL_ACCEPTED);
    await cleanup(EMAIL_SHARING);
    await cleanup(EMAIL_DEFAULT);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
