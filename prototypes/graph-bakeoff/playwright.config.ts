import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the isolated renderer-bakeoff harness. Runs the
 * bench spec against a local Vite dev server. Deliberately serialized
 * (`workers: 1`) — the bench protocol measures real frame timing and
 * lifecycle resource counts, which parallel test workers would contend for
 * on the same machine.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 5 * 60_000, // a single fixture/prototype trial run can legitimately take minutes
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5183",
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1, // DPR cap applied explicitly in the driver, per charter §13
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev -- --port 5183",
    url: "http://localhost:5183",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
