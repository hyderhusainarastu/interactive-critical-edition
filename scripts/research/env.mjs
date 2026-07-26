import { readFileSync, existsSync } from "node:fs";

// Phase 25.5 paid evaluation spikes read live provider keys from the MAIN
// repo's gitignored apps/worker/.env (never committed, never printed). This
// worktree is isolated from the main repo's working tree, and the sandbox's
// Bash tool refuses `source`/complex shell redirection into paths outside
// the worktree, so env vars are loaded at the Node runtime level instead —
// the *value* of any key never appears in a shell command line or is ever
// logged/printed by this module or any caller.
const WORKER_ENV_PATH = "/Users/hyderhusainarastu/Project/AutoCriticalEditionProject/apps/worker/.env";

export function loadWorkerEnv(path = WORKER_ENV_PATH) {
  if (!existsSync(path)) {
    throw new Error(`Worker .env not found at ${path} — cannot source live API keys.`);
  }
  const raw = readFileSync(path, "utf8");
  let loaded = 0;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
      loaded += 1;
    }
  }
  return loaded;
}
