#!/usr/bin/env node

/**
 * Migration-ledger merge gate (D-23-34, made mechanical).
 *
 * WHY THIS EXISTS
 * ---------------
 * Render and Vercel auto-deploy on every push to `main`. There is therefore no
 * such thing as "apply the migration later, during the integration phase" — a
 * merge ships the code and its schema dependency together whether or not the
 * DDL has actually run. On 2026-07-24 that cost a real (non-fatal) production
 * incident: the worker auto-deployed code reading two `processing_run` columns
 * about five hours before migration 0035 created them, and `sweepAbandonedRuns`
 * failed against the pre-migration schema until the DDL landed.
 *
 * This script fails when a migration exists locally but not in the production
 * Drizzle ledger, so "did I apply it?" is answered by a command instead of by
 * memory.
 *
 * WHY IT CANNOT RUN IN GITHUB CI
 * ------------------------------
 * It reads the PRODUCTION ledger through `supabase db query --linked`, which
 * authenticates with the operator's own Supabase CLI credential (macOS
 * Keychain, established once via `supabase login`). GitHub Actions has no such
 * credential, and giving it one would mean putting a production database
 * credential into CI — which this project deliberately does not do. So this is
 * a LOCAL MERGE GATE, run by hand before any push that ships
 * migration-dependent code:
 *
 *     node scripts/check-migration-ledger.mjs
 *
 * It is read-only: one `select` against `drizzle.__drizzle_migrations`. It
 * never writes, and it never applies anything.
 *
 * WHAT IT COMPARES
 * ----------------
 * Drizzle identifies an applied migration by the SHA-256 of the raw `.sql`
 * file's bytes (`drizzle-kit`'s own `readMigrationFiles` hashes the whole file
 * before splitting it on `--> statement-breakpoint`). So for every entry in
 * `packages/db/drizzle/meta/_journal.json` this hashes the corresponding file
 * and checks that exact hex string is present in the production ledger. A
 * hash-not-found means either "not applied yet" or "the file changed after it
 * was applied" — both are things you must not push past, and the message says
 * so rather than guessing which.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const drizzleDir = path.join(root, "packages/db/drizzle");
const journalPath = path.join(drizzleDir, "meta/_journal.json");

const LEDGER_QUERY = "select hash, created_at from drizzle.__drizzle_migrations order by created_at";

/**
 * The CLI renders results as a text table whose exact framing is not a stable
 * contract, so rather than parsing columns this pulls every 64-char lowercase
 * hex token out of the output. Migration hashes are the only values of that
 * shape the query can return (`created_at` is a bigint), which makes the
 * extraction robust to any table/box/ANSI formatting change.
 */
function extractHashes(output) {
  return new Set(output.match(/\b[0-9a-f]{64}\b/g) ?? []);
}

async function readProductionLedger() {
  try {
    const { stdout } = await execFileAsync("supabase", ["db", "query", "--linked", LEDGER_QUERY], {
      cwd: root,
      maxBuffer: 10 * 1024 * 1024,
    });
    return extractHashes(stdout);
  } catch (error) {
    const detail = [error?.stderr, error?.stdout, error?.message].find((part) => typeof part === "string" && part.trim() !== "");
    throw new Error(
      `Could not read the production Drizzle ledger via \`supabase db query --linked\`.\n` +
        `This script needs an authenticated Supabase CLI session (\`supabase login\`) and a linked project;\n` +
        `it cannot run in GitHub CI by design — see the header comment.\n\n${detail ?? error}`,
    );
  }
}

async function readLocalMigrations() {
  const journal = JSON.parse(await readFile(journalPath, "utf8"));
  const entries = Array.isArray(journal?.entries) ? journal.entries : [];
  if (entries.length === 0) throw new Error(`No entries found in ${path.relative(root, journalPath)}`);

  return Promise.all(
    entries.map(async (entry) => {
      const file = path.join(drizzleDir, `${entry.tag}.sql`);
      const contents = await readFile(file, "utf8");
      return {
        tag: entry.tag,
        file: path.relative(root, file),
        hash: createHash("sha256").update(contents).digest("hex"),
      };
    }),
  );
}

async function main() {
  const [local, applied] = await Promise.all([readLocalMigrations(), readProductionLedger()]);
  const missing = local.filter((migration) => !applied.has(migration.hash));

  if (missing.length === 0) {
    console.log(`Migration ledger OK — all ${local.length} local migration(s) are present in the production ledger.`);
    return;
  }

  console.error(
    `Migration ledger MISMATCH — ${missing.length} of ${local.length} local migration(s) are absent from the production ledger:\n`,
  );
  for (const migration of missing) {
    console.error(`  - ${migration.tag}  (${migration.file})\n    sha256 ${migration.hash}`);
  }
  console.error(
    `\nEither the migration has not been applied to production yet, or the .sql file was edited after it was applied.\n` +
      `Do NOT push code that reads the new schema until this is resolved (D-23-34): a push to main auto-deploys\n` +
      `to Render and Vercel immediately, so the code would run against a database that does not have these changes.`,
  );
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
