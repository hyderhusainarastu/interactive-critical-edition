/**
 * Bounded local load smoke. It deliberately targets only public, read-only
 * paths so it never creates uploads, queues paid analysis, or needs secrets.
 *
 * Example:
 *   LOAD_BASE_URL=http://localhost:3003 LOAD_REQUESTS=40 LOAD_CONCURRENCY=8 node scripts/load-smoke.mjs
 */
const baseUrl = process.env.LOAD_BASE_URL ?? "http://localhost:3000";
const requestCount = Math.min(100, Math.max(1, Number(process.env.LOAD_REQUESTS ?? 40)));
const concurrency = Math.min(20, Math.max(1, Number(process.env.LOAD_CONCURRENCY ?? 8)));
const paths = (process.env.LOAD_PATHS ?? "/,/login,/privacy").split(",").map((value) => value.trim()).filter(Boolean);
const queue = Array.from({ length: requestCount }, (_, index) => paths[index % paths.length]);
const durations = [];
const failures = [];

async function worker() {
  while (queue.length) {
    const path = queue.shift();
    if (!path) return;
    const started = performance.now();
    try {
      const response = await fetch(new URL(path, baseUrl), { redirect: "manual", signal: AbortSignal.timeout(10_000) });
      const elapsed = performance.now() - started;
      durations.push(elapsed);
      if (response.status < 200 || response.status >= 400) failures.push({ path, status: response.status });
    } catch (error) {
      durations.push(performance.now() - started);
      failures.push({ path, error: error instanceof Error ? error.message : String(error) });
    }
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, requestCount) }, worker));
durations.sort((left, right) => left - right);
const percentile = (fraction) => durations[Math.min(durations.length - 1, Math.ceil(durations.length * fraction) - 1)] ?? 0;
const summary = {
  baseUrl,
  requests: requestCount,
  concurrency,
  paths,
  successful: requestCount - failures.length,
  failures,
  averageMs: Number((durations.reduce((sum, value) => sum + value, 0) / durations.length).toFixed(1)),
  p95Ms: Number(percentile(0.95).toFixed(1)),
  maxMs: Number((durations.at(-1) ?? 0).toFixed(1)),
};
console.log(JSON.stringify(summary, null, 2));
if (failures.length) process.exitCode = 1;
