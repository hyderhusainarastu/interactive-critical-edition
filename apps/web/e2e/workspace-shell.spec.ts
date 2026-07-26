import { expect, test } from "@playwright/test";
import { db, users } from "@ice/db";
import { eq } from "drizzle-orm";
import { createVerifiedTestUser, deleteTestUser, seedPublishedEdition } from "./helpers";

const EMAIL = `e2e-workspace-shell-${Date.now()}@example.com`;
const PASSWORD = "password123";
let userId = "";

test.describe("Phase 12 workspace foundation", () => {
  test.beforeAll(async () => {
    userId = await createVerifiedTestUser(EMAIL, PASSWORD);
    await db
      .update(users)
      .set({
        preferences: {
          onboardedAt: new Date().toISOString(),
          workspace: {
            theme: "dark",
            fontSize: "medium",
            readingWidth: "comfortable",
            focusMode: false,
            scriptDisplay: "original",
          },
        },
      })
      .where(eq(users.id, userId));
  });

  test.afterAll(async () => {
    await deleteTestUser(EMAIL);
  });

  test("offers keyboard search and persists presentation controls", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL("/dashboard");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    await page.keyboard.press("Control+K");
    await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
    await expect(page.getByText("Navigate")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Command palette" })).toBeHidden();

    await page.getByRole("button", { name: "Workspace preferences" }).click();
    await page.getByLabel("Theme").selectOption("light");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();
  });

  test("traps focus in the command palette and returns focus to its trigger", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL("/dashboard");

    const trigger = page.getByRole("button", { name: "Search pages and works" });
    await trigger.focus();
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Command palette" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Search Palimnote")).toBeFocused();

    await page.keyboard.press("Shift+Tab");
    await expect(dialog.locator(":focus")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("opens workspace preferences as a keyboard-managed dialog", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL("/dashboard");

    const trigger = page.getByRole("button", { name: "Workspace preferences" });
    await trigger.focus();
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Workspace preferences" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Close preferences" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  // Live-issue fix lane (2026-07-25): the account menu and the preferences
  // menu opened then instantly closed in production right after signing in
  // (or after any navigation). Root cause: `(app)` routes render `AppShell`
  // (header, these two menus, etc.) as part of the routed page content that
  // `PageTransition`'s `AnimatePresence` used to wrap at the ROOT layout
  // level (see `app/layout.tsx`'s comment). An authenticated route's async
  // Server Component work streams in after the shell's first paint, and
  // `AnimatePresence`'s `mode="wait"` bookkeeping reacted to that
  // late-arriving content by silently tearing down and rebuilding the whole
  // wrapped subtree a second time ~150-200ms later — discarding whatever
  // `useState` (like a just-opened menu) existed in between.
  //
  // A plain `.click()` immediately after `waitForURL` did NOT reproduce
  // this (Playwright's synthetic click resolves before the real DOM "click"
  // event a browser fires from a raw mousedown→mouseup gesture, which is
  // what actually raced the remount in manual testing) — hence the explicit
  // `mouse.down()` / wait / `mouse.up()` sequence below, fired the instant
  // the dashboard URL resolves rather than after the page has settled. This
  // is the interaction pattern that reproduced the bug red on the pre-fix
  // tree; it stays green post-fix because `AppShell.tsx` now applies
  // `PageTransition` only around `<main>`'s routed content, keeping these
  // menus outside the animated/remounting boundary entirely.
  test("the account and preferences menus survive a click made immediately after navigation settles", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL("/dashboard");

    const preferencesTrigger = page.getByRole("button", { name: "Workspace preferences" });
    const preferencesBox = await preferencesTrigger.boundingBox();
    if (!preferencesBox) throw new Error("Workspace preferences trigger has no layout box");
    await page.mouse.move(preferencesBox.x + preferencesBox.width / 2, preferencesBox.y + preferencesBox.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(20);
    await page.mouse.up();

    const preferencesDialog = page.getByRole("dialog", { name: "Workspace preferences" });
    await expect(preferencesDialog).toBeVisible();
    // The bug closed the panel within ~200ms of it opening; staying visible
    // across a real wait (not just the instant after the click) is the
    // actual proof — a synchronous check right after the click would pass
    // even on the broken tree, since the phantom remount is itself delayed.
    await page.waitForTimeout(500);
    await expect(preferencesDialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(preferencesDialog).toBeHidden();

    const profileTrigger = page.getByRole("button", { name: "Account menu" });
    const profileBox = await profileTrigger.boundingBox();
    if (!profileBox) throw new Error("Account menu trigger has no layout box");
    await page.mouse.move(profileBox.x + profileBox.width / 2, profileBox.y + profileBox.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(20);
    await page.mouse.up();

    const profileDialog = page.getByRole("dialog", { name: "Account menu" });
    await expect(profileDialog).toBeVisible();
    await page.waitForTimeout(500);
    await expect(profileDialog).toBeVisible();
  });

  // Live-issue fix lane (2026-07-25, continued): a genuinely separate defect
  // from the PageTransition remount test above. This one is the trigger's
  // OWN toggle logic firing twice for a single physical click — on the
  // owner's hardware (mouse switch-bounce, some macOS trackpad double-fire
  // cases), a single physical click delivers two full pointerdown/click
  // event pairs at a VARIABLE gap apart. A first fix (`useReopenGuard(250)`)
  // provably suppressed bounces up to ~250ms, but the owner kept seeing the
  // panel close anyway — their hardware's real bounce gap sometimes exceeds
  // any fixed window, so a timing window is a losing game no matter how
  // wide. The definitive fix removes the window entirely: a pointer click
  // on the trigger while the panel is already open now does NOTHING (see
  // `AppShell.tsx`'s trigger `onClick` handlers, `event.detail >= 1`
  // branch), so no bounce gap, however large, can close the panel via the
  // trigger itself. Real dismissal-by-pointer now happens through
  // `useOutsideMenuClose` (tested separately below); the panel's own
  // close button and Escape are unaffected.
  //
  // Parametrized across three gaps — 75ms (the originally captured bounce
  // gap), 400ms and 600ms (both comfortably past the OLD 250ms guard
  // window) — because the whole point of the redesign is that NO gap can
  // close the panel via the trigger anymore. The 400ms/600ms cases are the
  // actual red→green proof: run this exact test (unchanged) against the
  // pre-fix tree — `git stash push -u -- apps/web/src/hooks/useReopenGuard.ts
  // apps/web/src/hooks/useOutsideMenuClose.ts apps/web/src/components/app/
  // AppShell.tsx "apps/web/src/app/(app)/works/[workId]/reader/
  // RagChatPanel.tsx"`, rebuild, and only the 400ms/600ms cases fail (the
  // second click lands past the 250ms guard window and genuinely closes the
  // panel); `git stash pop`, rebuild, and all three pass.
  for (const gapMs of [75, 400, 600]) {
    test(`survives two click events ~${gapMs}ms apart on the same trigger (switch-bounce/double-fire), staying open`, async ({ page }) => {
      await page.goto("/login");
      await page.getByLabel("Email").fill(EMAIL);
      await page.getByLabel("Password").fill(PASSWORD);
      await page.getByRole("button", { name: "Log in" }).click();
      await page.waitForURL("/dashboard");

      async function doubleFireClick(locator: ReturnType<typeof page.getByRole>) {
        const box = await locator.boundingBox();
        if (!box) throw new Error("trigger has no layout box");
        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.up();
        await page.waitForTimeout(gapMs);
        await page.mouse.down();
        await page.mouse.up();
      }

      // A safe, non-interactive outside target for the deliberate-close
      // assertion below — a raw native `mouse.down()` on the trigger (as
      // `doubleFireClick` does, unlike Playwright's own higher-level
      // `.click()`) moves DOM focus to that button by itself (ordinary
      // browser mousedown-focuses-the-target behavior), which lands focus
      // OUTSIDE the panel's own DOM subtree — so Escape (scoped to the
      // panel's `onKeyDown`) would not reliably reach it after a bounce.
      // Outside-click is both the realistic next user action and the
      // deliberate-close path guaranteed to work regardless of where the
      // bounce left focus.
      const background = page.getByRole("heading", { level: 1 });

      const preferencesTrigger = page.getByRole("button", { name: "Workspace preferences" });
      await doubleFireClick(preferencesTrigger);
      const preferencesDialog = page.getByRole("dialog", { name: "Workspace preferences" });
      await expect(preferencesDialog).toBeVisible();
      // Not just an instant-after check: staying visible across a longer
      // real wait is the actual proof, not just surviving the immediate
      // aftermath of the second click.
      await page.waitForTimeout(300);
      await expect(preferencesDialog).toBeVisible();
      // A genuine, deliberate close must still work — the fix must not make
      // the panel permanently sticky.
      await background.click();
      await expect(preferencesDialog).toBeHidden();

      // `exact` avoids matching the panel's own "Close account menu" button,
      // whose accessible name otherwise substring-contains this one once the
      // panel is open (the same ambiguity class D-19-1 fixed once already
      // for "Theme").
      const profileTrigger = page.getByRole("button", { name: "Account menu", exact: true });
      await doubleFireClick(profileTrigger);
      const profileDialog = page.getByRole("dialog", { name: "Account menu" });
      await expect(profileDialog).toBeVisible();
      await page.waitForTimeout(300);
      await expect(profileDialog).toBeVisible();
      await background.click();
      await expect(profileDialog).toBeHidden();
    });
  }

  // Live-issue fix lane (2026-07-25, continued): the outside-click half of
  // the redesign — this codebase had no outside-click-to-close at all before
  // this fix. `useOutsideMenuClose` listens for `pointerdown` in the capture
  // phase and excludes both the trigger and the panel (siblings inside one
  // `position: relative` container), so it cannot be confused by the very
  // click that opened the menu (see that hook's doc comment for the full
  // sequencing argument).
  test("a pointer click on the page background closes an open preferences/account menu, without stealing focus back to the trigger", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL("/dashboard");

    // A real, non-interactive page element well outside either menu's
    // container — the dashboard's own `PageHeader` heading.
    const background = page.getByRole("heading", { level: 1 });
    await expect(background).toBeVisible();

    const preferencesTrigger = page.getByRole("button", { name: "Workspace preferences" });
    await preferencesTrigger.click();
    const preferencesDialog = page.getByRole("dialog", { name: "Workspace preferences" });
    await expect(preferencesDialog).toBeVisible();
    await background.click();
    await expect(preferencesDialog).toBeHidden();
    // Deliberately the opposite of the Escape/explicit-close convention:
    // an outside click must not yank focus back to the trigger — see
    // `useOutsideMenuClose`'s doc comment.
    await expect(preferencesTrigger).not.toBeFocused();

    const profileTrigger = page.getByRole("button", { name: "Account menu", exact: true });
    await profileTrigger.click();
    const profileDialog = page.getByRole("dialog", { name: "Account menu" });
    await expect(profileDialog).toBeVisible();
    await background.click();
    await expect(profileDialog).toBeHidden();
    await expect(profileTrigger).not.toBeFocused();
  });

  // Live-issue fix lane (2026-07-25, continued): keyboard activation is
  // deliberately exempt from the open-only-pointer restriction — a real
  // second keypress is never bounce-fast, and screen-reader users expect an
  // aria-expanded trigger button to toggle. The click event's own `detail`
  // (0 for a keyboard-synthesized click, >=1 for a real pointer click) is
  // what the trigger's `onClick` handler checks to tell the two apart.
  test("keyboard Enter toggles the preferences and account menus open, then closed", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL("/dashboard");

    const preferencesTrigger = page.getByRole("button", { name: "Workspace preferences" });
    await preferencesTrigger.focus();
    await expect(preferencesTrigger).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("Enter");
    const preferencesDialog = page.getByRole("dialog", { name: "Workspace preferences" });
    await expect(preferencesDialog).toBeVisible();
    await expect(preferencesTrigger).toHaveAttribute("aria-expanded", "true");

    // Opening moves focus into the panel (its own close button, existing
    // convention) — refocusing the trigger here simulates a keyboard user
    // tabbing back to it, which is what actually exercises the trigger's
    // own toggle-to-close path rather than the panel's separate close
    // button.
    await preferencesTrigger.focus();
    await page.keyboard.press("Enter");
    await expect(preferencesDialog).toBeHidden();
    await expect(preferencesTrigger).toHaveAttribute("aria-expanded", "false");
    // `closePreferences` restores focus via `requestAnimationFrame`, which
    // can still be pending here — waiting for it to actually land avoids a
    // race where the next `profileTrigger.focus()` below gets silently
    // overridden by that delayed rAF callback re-focusing the preferences
    // trigger a tick later (observed flake: Enter then re-opened
    // preferences instead of opening the account menu).
    await expect(preferencesTrigger).toBeFocused();

    const profileTrigger = page.getByRole("button", { name: "Account menu", exact: true });
    await profileTrigger.focus();
    await expect(profileTrigger).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("Enter");
    const profileDialog = page.getByRole("dialog", { name: "Account menu" });
    await expect(profileDialog).toBeVisible();
    await expect(profileTrigger).toHaveAttribute("aria-expanded", "true");

    await profileTrigger.focus();
    await page.keyboard.press("Enter");
    await expect(profileDialog).toBeHidden();
    await expect(profileTrigger).toHaveAttribute("aria-expanded", "false");
  });

  // Live-issue fix lane (2026-07-25, continued): the redesign leaves
  // item-click-to-close untouched (point 3 of the design) — this exercises
  // that path directly for the account menu, since nothing else in this
  // file previously clicked one of `ProfileMenu`'s own links.
  test("clicking an account menu item closes the menu and navigates", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL("/dashboard");

    const profileTrigger = page.getByRole("button", { name: "Account menu", exact: true });
    await profileTrigger.click();
    const profileDialog = page.getByRole("dialog", { name: "Account menu" });
    await expect(profileDialog).toBeVisible();
    await profileDialog.getByRole("link", { name: "Profile" }).click();
    await page.waitForURL("**/account/profile");
    await expect(profileDialog).toBeHidden();
  });

  test("moves focus to the exit control when focus mode hides the shell", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL("/dashboard");

    await page.getByRole("button", { name: "Workspace preferences" }).click();
    const focusMode = page.getByRole("checkbox", { name: "Focus mode" });
    await focusMode.focus();
    await page.keyboard.press("Space");

    const exit = page.getByRole("button", { name: "Exit focus mode" });
    await expect(exit).toBeVisible();
    await expect(exit).toBeFocused();
    const shellHeader = page.getByRole("banner");
    await expect(shellHeader).toHaveAttribute("inert", "");
    await page.keyboard.press("Tab");
    await expect(shellHeader.locator(":focus")).toHaveCount(0);

    await exit.click();
    await expect(page.getByRole("button", { name: "Workspace preferences" })).toBeFocused();
  });

  test("text size changes the actual reading font size and persists after a reload", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL("/dashboard");

    const bodyFontSizePx = () => page.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize));
    const baseline = await bodyFontSizePx();

    await page.getByRole("button", { name: "Workspace preferences" }).click();
    const [smallResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().includes("/api/preferences") && res.ok()),
      page.getByLabel("Text size").selectOption("small"),
    ]);
    expect(smallResponse.ok()).toBe(true);
    await expect(page.locator("html")).toHaveAttribute("data-font-size", "small");
    const small = await bodyFontSizePx();
    expect(small).toBeLessThan(baseline);

    const [largeResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().includes("/api/preferences") && res.ok()),
      page.getByLabel("Text size").selectOption("large"),
    ]);
    expect(largeResponse.ok()).toBe(true);
    await expect(page.locator("html")).toHaveAttribute("data-font-size", "large");
    const large = await bodyFontSizePx();
    expect(large).toBeGreaterThan(small);

    // Clear the client-side copy so a reload can only be reflecting what the
    // server actually persisted to the database, not localStorage.
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-font-size", "large");
    expect(await bodyFontSizePx()).toBe(large);
  });

  test("reading width sets a real CSS custom property distinct per option and persists after a reload", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL("/dashboard");

    const readingMeasure = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--reading-measure").trim());

    await page.getByRole("button", { name: "Workspace preferences" }).click();
    await Promise.all([
      page.waitForResponse((res) => res.url().includes("/api/preferences") && res.ok()),
      page.getByLabel("Reading width").selectOption("compact"),
    ]);
    await expect(page.locator("html")).toHaveAttribute("data-reading-width", "compact");
    const compact = await readingMeasure();
    expect(compact).toBe("58ch");

    await Promise.all([
      page.waitForResponse((res) => res.url().includes("/api/preferences") && res.ok()),
      page.getByLabel("Reading width").selectOption("wide"),
    ]);
    await expect(page.locator("html")).toHaveAttribute("data-reading-width", "wide");
    const wide = await readingMeasure();
    expect(wide).toBe("88ch");
    expect(wide).not.toBe(compact);

    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-reading-width", "wide");
  });

  test("the focus-mode checkbox reflects the applied preference on and off", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL("/dashboard");

    await page.getByRole("button", { name: "Workspace preferences" }).click();
    const focusCheckbox = page.getByRole("checkbox", { name: "Focus mode" });
    await expect(focusCheckbox).not.toBeChecked();

    // Plain .click(), not .check(): .check() clicks AND then waits to
    // re-verify the checkbox reads checked=true, but enabling focus mode
    // unmounts this very checkbox (the panel auto-closes), so that
    // verification would wait on a detached element forever. The existing
    // D-19-20 test hit the same constraint and used a keyboard Space press
    // for the same reason.
    await focusCheckbox.click();
    // The checked state itself is then verified through persistence and
    // the exit control rather than re-reading the (now-gone) checkbox.
    await expect(page.getByRole("button", { name: "Exit focus mode" })).toBeVisible();

    // Force a reload to read the persisted value from the server (clearing
    // localStorage first so this can only be proving the DB round-trip, not
    // the browser's own cached copy) — the Exit control being visible
    // immediately, pre-interaction, is the proof the "on" state survived.
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.getByRole("button", { name: "Exit focus mode" })).toBeVisible();

    // Exiting sets the preference back to false; re-opening preferences has
    // to show the checkbox reflecting that — not a stale "checked" left
    // over from before the reload.
    await page.getByRole("button", { name: "Exit focus mode" }).click();
    await expect(page.getByRole("banner")).not.toHaveClass(/sr-only/);
    await page.getByRole("button", { name: "Workspace preferences" }).click();
    await expect(page.getByRole("checkbox", { name: "Focus mode" })).not.toBeChecked();
  });

  test("logging out ends the session; a protected route then redirects to /login", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL("/dashboard");

    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL("/");

    await page.goto("/dashboard");
    await page.waitForURL(/\/login/);
    await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();
  });

  test("treats mobile navigation as a modal drawer and restores its trigger", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 844 });
    await page.goto("/login");
    await page.getByLabel("Email").fill(EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL("/dashboard");

    const trigger = page.getByRole("button", { name: "Open navigation" });
    await trigger.focus();
    await trigger.click();
    const drawer = page.getByRole("dialog", { name: "Mobile navigation" });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("button", { name: "Close navigation" })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(drawer.locator(":focus")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  // Phase 22.5/22.6 (plan §22.6): the shell-level global RAG sidebar
  // (D-22-8 — previously there was no entry point to Ask Library outside
  // the Reader and a full-page nav link at all). Named distinctly from the
  // Reader's own contextual "Ask Library" toggle ("Library chat sidebar"
  // vs. "Ask Library") specifically to avoid the substring accessible-name
  // ambiguity D-19-1 already fixed once for "Theme" — both buttons are
  // reachable on the same Reader page, so the two names must not overlap.
  test.describe("Global Ask Library sidebar", () => {
    test.skip(process.env.PHASE_18_RAG_ENABLED !== "true", "requires the local-only Phase 18 RAG gate");

    test("offers a persistent sidebar trigger on a non-Reader route as a keyboard-managed dialog", async ({ page }) => {
      await page.goto("/login");
      await page.getByLabel("Email").fill(EMAIL);
      await page.getByLabel("Password").fill(PASSWORD);
      await page.getByRole("button", { name: "Log in" }).click();
      await page.waitForURL("/dashboard");

      const trigger = page.getByRole("button", { name: "Library chat sidebar" });
      await expect(trigger).toBeVisible();
      await expect(trigger).toHaveAttribute("aria-expanded", "false");

      await trigger.focus();
      await trigger.click();
      const dialog = page.getByRole("dialog", { name: "Ask Library — global sidebar" });
      await expect(dialog).toBeVisible();
      await expect(trigger).toHaveAttribute("aria-expanded", "true");
      await expect(dialog.getByRole("button", { name: "Close chat" })).toBeFocused();
      await expect(dialog.getByText("Scope: Entire Library")).toBeVisible();

      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(trigger).toBeFocused();
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
    });

    test("keeps the sidebar open across a route navigation", async ({ page }) => {
      await page.goto("/login");
      await page.getByLabel("Email").fill(EMAIL);
      await page.getByLabel("Password").fill(PASSWORD);
      await page.getByRole("button", { name: "Log in" }).click();
      await page.waitForURL("/dashboard");

      await page.getByRole("button", { name: "Library chat sidebar" }).click();
      const dialog = page.getByRole("dialog", { name: "Ask Library — global sidebar" });
      await expect(dialog).toBeVisible();

      await page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", { name: "Library", exact: true }).click();
      await page.waitForURL("**/library");
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText("Scope: Entire Library")).toBeVisible();
    });

    test("scopes the sidebar to the current work when opened from a work-scoped route", async ({ page }) => {
      const { workId } = await seedPublishedEdition(userId);
      await page.goto("/login");
      await page.getByLabel("Email").fill(EMAIL);
      await page.getByLabel("Password").fill(PASSWORD);
      await page.getByRole("button", { name: "Log in" }).click();
      await page.waitForURL("/dashboard");

      await page.goto(`/works/${workId}`);
      await page.getByRole("button", { name: "Library chat sidebar" }).click();
      const dialog = page.getByRole("dialog", { name: "Ask Library — global sidebar" });
      await expect(dialog.getByText("Scope: Current work")).toBeVisible();
    });

    // D-22-20: the Reader's own contextual drawer and this shell-level global
    // sidebar both render the shared `RagChatPanel` as a `dialog`, and both
    // are reachable independently on the same Reader route — before the fix
    // they shared one accessible name ("Library-grounded Socratic chat"), so
    // opening both left two dialogs indistinguishable to assistive tech. Each
    // now gets its own name (`getByRole` with `exact` resolves uniquely).
    test("names the Reader's contextual drawer and the global sidebar distinctly when both are open", async ({ page }) => {
      const { workId } = await seedPublishedEdition(userId);
      await page.goto("/login");
      await page.getByLabel("Email").fill(EMAIL);
      await page.getByLabel("Password").fill(PASSWORD);
      await page.getByRole("button", { name: "Log in" }).click();
      await page.waitForURL("/dashboard");

      await page.goto(`/works/${workId}/reader`);
      await page.getByRole("button", { name: "Ask Library", exact: true }).click();
      await page.getByRole("button", { name: "Library chat sidebar" }).click();

      const readerDrawer = page.getByRole("dialog", { name: "Ask Library — Reader panel", exact: true });
      const globalSidebar = page.getByRole("dialog", { name: "Ask Library — global sidebar", exact: true });
      await expect(readerDrawer).toBeVisible();
      await expect(globalSidebar).toBeVisible();
    });

    test("renders as a bottom sheet on mobile, reachable from its own visible trigger", async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 844 });
      await page.goto("/login");
      await page.getByLabel("Email").fill(EMAIL);
      await page.getByLabel("Password").fill(PASSWORD);
      await page.getByRole("button", { name: "Log in" }).click();
      await page.waitForURL("/dashboard");

      const trigger = page.getByRole("button", { name: "Library chat sidebar" });
      await expect(trigger).toBeVisible();
      await trigger.click();
      const dialog = page.getByRole("dialog", { name: "Ask Library — global sidebar" });
      await expect(dialog).toBeVisible();
      // The desktop-only resize separator must not appear on a mobile sheet.
      await expect(page.getByRole("separator", { name: "Resize Ask Library sidebar" })).toBeHidden();
      // Anchored as a bottom sheet (some gap above it), not a full-height drawer.
      const box = await dialog.boundingBox();
      expect(box?.y).toBeGreaterThan(100);

      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(trigger).toBeFocused();
    });
  });
});
