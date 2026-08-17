import {
  boolean,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { readerLevelEnum } from "./enums";

/**
 * Phase 1 scope only: auth tables. Shape follows the @auth/drizzle-adapter
 * Postgres convention (accounts/sessions/verificationTokens) so Auth.js
 * works with minimal glue and OAuth providers can be added later (plan §14)
 * without a schema change. `passwordHash` extends the standard user table
 * for the Credentials provider (plan §14).
 *
 * The full domain schema (works, annotations, graph_edges, etc. — plan §9)
 * rolls in incrementally in later phases via their own migrations, not
 * all at once here.
 */

export const users = pgTable("user", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: timestamp("email_verified", { mode: "date" }),
  image: text("image"),
  passwordHash: text("password_hash"),
  /**
   * Auth.js v5's Credentials provider requires the JWT session strategy —
   * database sessions only auto-wire for OAuth-style adapter flows (plan
   * §14 assumed DB sessions; this is a recorded deviation, see docs/PROJECT-LOG.md).
   * Incrementing this invalidates every outstanding JWT for the user
   * (checked in the `jwt` callback), giving server-side "sign out
   * everywhere" / revocation-on-deletion without needing DB sessions.
   */
  sessionVersion: integer("session_version").notNull().default(0),
  /**
   * Phase 6: user preferences (plan §9). Currently { expertise?:
   * "beginner"|"intermediate"|"advanced", onboardedAt?: string } — the
   * onboarding-completion marker and the default expertise the roadmap
   * uses. jsonb so more preferences can be added without a migration.
   */
  preferences: jsonb("preferences"),
  /**
   * Phase 9: the reader's level, promoted out of the `preferences` jsonb into
   * a typed column with FOUR levels (plan §34.4 9.4). Migration `0015`
   * backfills it from `preferences.expertise`, mapping the old three-level
   * vocabulary (`intermediate` → `undergraduate`); the jsonb key is left in
   * place until 9.4 moves the readers over, so 9.1 changes no behaviour.
   *
   * Null means "not chosen" — the caller applies its own default rather than
   * this column pretending the user picked something. The level only ever
   * changes what opens by DEFAULT, never what is reachable.
   */
  readerLevel: readerLevelEnum("reader_level"),
  /**
   * Workstream G (v.5): explicit, unchecked-by-default opt-in for the
   * research-sharing described on the privacy page. Defaults false so
   * every pre-existing account stays opted out until they choose otherwise.
   */
  dataSharingEnabled: boolean("data_sharing_enabled").notNull().default(false),
  /**
   * Signup consent timestamp. Null means "pre-checkbox account" — the
   * consent flow shipped after this user already existed, not that they
   * declined; never backfilled, since there is nothing honest to backfill it
   * with.
   */
  policyAcceptedAt: timestamp("policy_accepted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const accounts = pgTable(
  "account",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    // @auth/drizzle-adapter's AdapterAccount type requires these specific
    // snake_case JS keys (matching OAuth2 spec field names) — DB column
    // names are unaffected, so this needed no new migration.
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => [
    primaryKey({
      columns: [account.provider, account.providerAccountId],
    }),
  ],
);

export const sessions = pgTable("session", {
  sessionToken: text("session_token").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_token",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (vt) => [primaryKey({ columns: [vt.identifier, vt.token] })],
);

export const passwordResetTokens = pgTable(
  "password_reset_token",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
    used: boolean("used").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);
