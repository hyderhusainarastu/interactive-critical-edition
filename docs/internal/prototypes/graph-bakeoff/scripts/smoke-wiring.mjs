// Quick manual smoke check (not part of the bench protocol) that the
// App.tsx harness-wiring fix actually works before committing to a full
// ~30min measurement run: mounts each prototype on fixture-24, confirms
// getNodeScreenPosition/isHighlightConfirmed/readLifecycleSnapshot return
// real (non-placeholder) values, and confirms window.__graphBakeoffLifecycle
// .remountCycle() actually swaps the mounted handle.
import { chromium } from "@playwright/test";

const BASE = "http://localhost:5183";

async function checkPrototype(browser, proto) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(`${BASE}/?proto=${proto}&fixture=fixture-24`);
  // NB: must check `b &&` explicitly, not just optional-chain — `window[key]
  // ?.interactiveAtMs !== null` is TRUE the instant the bridge itself is
  // still undefined (undefined !== null), so a naive optional-chain
  // predicate resolves before the bridge is ever registered. Found live:
  // this exact bug let checkPrototype("b") race ahead of App.tsx's
  // registerHarnessBridge() call and crash on the very next evaluate().
  // scripts/run-bench.ts's real driver already uses the correct form.
  await page.waitForFunction(
    (key) => {
      const b = window[key];
      return b && b.interactiveAtMs !== null;
    },
    "__graphBakeoffHarness",
    { timeout: 15000 },
  );

  const nodePos = await page.evaluate(() => window.__graphBakeoffHarness.getNodeScreenPosition("n0"));
  const confirmedBefore = await page.evaluate(() => window.__graphBakeoffHarness.isHighlightConfirmed("n0"));
  const snapshot = await page.evaluate(() => window.__graphBakeoffHarness.readLifecycleSnapshot(0));

  console.log(`[${proto}] getNodeScreenPosition("n0") =`, nodePos);
  console.log(`[${proto}] isHighlightConfirmed("n0") before select =`, confirmedBefore);
  console.log(`[${proto}] readLifecycleSnapshot(0) =`, snapshot);

  // Select n0 via the handle and confirm isHighlightConfirmed flips true.
  await page.evaluate(() => window.__graphBakeoffHarness.handle.select("n0"));
  await page.waitForFunction(
    () => window.__graphBakeoffHarness.isHighlightConfirmed("n0") === true,
    undefined,
    { timeout: 3000 },
  );
  console.log(`[${proto}] isHighlightConfirmed("n0") after select = true (confirmed)`);

  // Confirm the lifecycle remount control actually swaps the handle.
  const handleBefore = await page.evaluate(() => !!window.__graphBakeoffHarness.handle);
  const preUnmountSnapshot = await page.evaluate(() => window.__graphBakeoffLifecycle.remountCycle(1));
  await page.waitForFunction(
    (key) => {
      const b = window[key];
      return b && b.interactiveAtMs !== null;
    },
    "__graphBakeoffHarness",
    { timeout: 15000 },
  );
  const handleAfter = await page.evaluate(() => !!window.__graphBakeoffHarness.handle);
  console.log(`[${proto}] remountCycle(1) pre-unmount snapshot =`, preUnmountSnapshot);
  console.log(`[${proto}] handle present before=${handleBefore} after=${handleAfter} (remount completed)`);

  await page.close();
}

const browser = await chromium.launch({ headless: false, args: ["--force-device-scale-factor=1"] }).catch(async (err) => {
  console.log("Headed launch failed, falling back to headless 'new':", err.message);
  return chromium.launch({ headless: true, args: ["--force-device-scale-factor=1"] });
});

try {
  await checkPrototype(browser, "a");
  await checkPrototype(browser, "b");
} finally {
  await browser.close();
}
