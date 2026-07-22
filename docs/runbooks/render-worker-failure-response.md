# Runbook: Render Worker Failure Response

Standing procedure for diagnosing a Render server-failure notification for `interactive-critical-edition-worker` (`srv-d9dgiamrnols73ccpa10`). Written from the Phase 19 incident diagnosis (`docs/incidents/render-server-failures-phase-19.md`); extends the Render-specific entries already in `docs/PROJECT-LOG.md` Known Problems rather than replacing them.

## 1. Establish the failure class first — cheapest checks first

```sh
# 1. Is this actually a Render deploy failure, or a runtime crash of an
#    otherwise-live deploy? Check deploy status before reading any log.
render deploys list srv-d9dgiamrnols73ccpa10 --output json
#   - status "build_failed"/"update_failed"/"canceled" → deploy-time failure, go to §2.
#   - status "live" for the newest entry, "deactivated" for older ones →
#     the deploy succeeded; a notification means a runtime crash/restart,
#     go to §3.

# 2. External-outage check (see PROJECT-LOG Known Problems — a GitHub
#    outage previously produced a misleading "could not read Username"
#    clone failure that looked identical to a revoked OAuth connection).
curl -s https://www.githubstatus.com/api/v2/status.json
```

## 2. Deploy-time (build/boot) failure

1. Diff the failing commit against the last `live` deploy's commit.
2. Check: Node/Corepack/pnpm activation, lockfile compatibility, `--env-file-if-exists` behavior, build/start command, required env vars present (never print values).
3. Reproduce the build locally: `corepack enable && pnpm install --frozen-lockfile && pnpm --filter worker start` with a sanitized local env.

## 3. Runtime crash of a live deploy (this is what R-19-1 was)

```sh
render logs --resources srv-d9dgiamrnols73ccpa10 --output json --limit 200 \
  --start <T-5min> --end <T+2min>
```

The CLI's JSON output is **concatenated JSON objects, not a JSON array or newline-delimited JSON** — a plain `json.load()` will fail with "Extra data". Parse by tracking brace depth (see the incident record's investigation commands) or pipe through `jq -c .` if available.

Look for, in order of how often they've actually occurred here:
1. `unsupported Unicode escape sequence` (pg client, unpaired surrogate in a query param) — should not recur after the Phase 19 `sanitizeExtractedText` fix; if it does, the leak is in a text path that doesn't route through `packages/ingestion`'s `parseDocument()`, find and wrap it.
2. `ECIRCUITBREAKER` / auth failures right after a DB password reset — transient, retry ~20s apart for up to ~2 minutes (documented, not a bug).
3. `ENETUNREACH` on `db.<ref>.supabase.co` — wrong connection string; the worker must use the Supavisor pooler (`aws-0-us-east-1.pooler.supabase.com:6543`), never the direct IPv6-only host.
4. Any crash now reaches `reportError` before the process exits (Phase 19 addition to `apps/worker/src/index.ts`) — check Sentry (if `SENTRY_DSN` is configured) or the structured `[reportError]` log line first; it carries `scope`, the resolved pipeline version, and the deploy commit.

## 4. After identifying the cause

1. Reproduce locally against a production build with a sanitized env before trusting a fix.
2. Add a regression test that fails on the old behavior.
3. Ship the smallest correct repair.
4. Verify via a fresh `render deploys create` (not `render restart` — restart does not re-read env vars or re-run the build, see `docs/PROJECT-LOG.md` Known Problems) and confirm the new instance's own startup log line, not just the API's 200 response.
5. Record the incident in `docs/incidents/` following the R-19-1 table shape, and update this runbook if the failure class is new.

## 5. Do not

- Redeploy repeatedly hoping a transient issue clears without identifying the failure class first (burns deploy minutes and hides the real signal).
- Treat a `render restart` as equivalent to a fresh deploy for verifying an env-var or code change.
- Assume "could not read Username for 'https://github.com'" means the GitHub connection needs reconnecting — check githubstatus.com first.
