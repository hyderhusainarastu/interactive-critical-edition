# Landing-Page Visual Contract (Phase 19.4)

Per `palimnote_phases_19_23_plan_revised.md` §2.1/§19.4. These are the immutable reference fixtures the real authenticated Reader, Annotations, and Roadmap must be brought into parity with in Phase 22 — not the other way around. Captured from `apps/web/src/app/page.tsx`'s `ReaderShowcase()` and `RoadmapShowcase()` components via `apps/web/e2e/landing-contract.spec.ts`, generated against the real local dev server through the official `mcr.microsoft.com/playwright:v1.61.1-noble` Docker image so the checked-in baselines are Linux-flavored and match what CI's Ubuntu runner will actually compare against (not the macOS-flavored screenshots this machine would produce natively — Playwright's snapshot filenames are platform-suffixed and a `-darwin` baseline is silently ignored by a Linux CI run).

## One important structural fact

**There is no separate landing "Reader" section distinct from "Annotations."** `page.tsx` has exactly one combined showcase — eyebrow "The reader", heading "Annotations that show their work" — that depicts both at once: continuous reading prose with an inline annotation marker, and the annotation detail card it reveals. The plan's file-naming convention (`landing-reader-*.png` and `landing-annotations-*.png` as separate files) is honored literally, but both pairs are byte-identical copies of the same one section, because that is the actual state of the landing page. This is recorded here rather than fabricating a second, non-existent section. `RoadmapShowcase()` is the separate, genuinely distinct Roadmap depiction (`landing-roadmap-*.png`).

## Reader/Annotations showcase (`landing-reader-*.png`, `landing-annotations-*.png`)

- **Eyebrow** (small caps, mono, umber accent): "The reader"
- **Heading** (serif, semibold, 2xl/3xl): "Annotations that show their work"
- **Lead paragraph** (muted text): "Hover any marker and see what a passage references, why, and how sure the system is — with the exact source text that triggered it. Approve, edit, or dismiss anything. Original footnotes, automated annotations, and your own notes stay visually distinct."
- **Figure card**: rounded-xl border, surface background, subtle shadow, padding `p-5`.
  - Serif body text at `1.05rem`/`1.7` line-height, reading: "The question of the meaning of Being must be raised anew. Here the inquiry builds directly on Kant's transcendental method [marker], which first cleared the ground for the question."
  - Inline annotation marker: a small "❋" glyph, colored via the `--reader-annotation-color` CSS custom property (green here = `--color-accent-green`, the `conceptual_influence` category color from `CATEGORY_META`), `aria-hidden` (decorative in this illustrative context — the real reader's markers are interactive and accessibly labeled).
  - Detail panel below (rounded-lg border, background surface, `p-3`):
    - Row 1: colored circular icon badge (same "❋" glyph, filled circle, background = category color) + bold category label in the category color ("Conceptual influence") + right-aligned confidence text in muted color ("High · 82%").
    - Row 2: medium-weight target title ("Critique of Pure Reason — Immanuel Kant").
    - Row 3: small muted explanation + provenance ("Shaped the ideas of the primary text. Resolved to a bibliographic record via Crossref.").
- **Layout**: two-column grid on `md:` and above (text left, figure right — `flip=false`), single column stacked on mobile. Section has a top border rule, `max-w-5xl` centered container, `py-16` vertical padding, `gap-8`/`md:gap-12`.

## Roadmap showcase (`landing-roadmap-*.png`)

- **Eyebrow**: "The roadmap"
- **Heading**: "A reading order, not a pile of citations"
- **Lead paragraph**: "Every reference is ranked into priority tiers and ordered by what depends on what. Rate what you already know and the plan re-sorts to skip it. Filter by time budget, depth, or expertise."
- **Item list** (three example rows, each a rounded-lg bordered card with `p-3`, `gap-3` flex row):
  1. Numeral "1" (mono, muted) → colored dot (burgundy) → tier label "Essential" (small caps, burgundy) → title "Critique of Pure Reason" (medium weight) → reason "A prerequisite — read first." (small, muted).
  2. Numeral "2" → dot (ink) → tier "High priority" → "Logical Investigations" → "Shaped the text's method."
  3. Numeral "3" → dot (umber) → tier "Comparative" → "The Myth of Sisyphus" → "A parallel, not a prerequisite."
- **Layout**: two-column grid, text column on the right (`flip=true`, `md:order-2`) on desktop, stacked on mobile; otherwise matches the Reader/Annotations showcase's section chrome (top border, `max-w-5xl`, `py-16`).

## Colors, spacing, typography tokens in play

All values are the project's existing CSS custom properties (`--color-text`, `--color-text-muted`, `--color-border`, `--color-surface`, `--color-background`, `--color-accent-{umber,green,burgundy,ink}`) — no new tokens were introduced for these showcases. Headings use the serif display font; eyebrows and eventual body copy use the sans/mono stack already documented in `docs/PROJECT-LOG.md`'s Design Decisions table (credibility/contrast tokens, `CATEGORY_META` color mapping).

## Responsive behavior

Both showcases collapse from a two-column `md:grid-cols-2` layout to a single stacked column below the `md` breakpoint (Tailwind default 768px). The mobile baselines here were captured at 375×812 (a standard small-phone viewport); the desktop baselines at 1280×900.

## Interaction/motion states

The landing showcases are static illustrative content — the marker and detail card are always rendered open, not click-to-reveal (unlike the real authenticated Reader/Annotations sidebar, which is interactive). No hover/focus states apply to this illustrative figure itself; the surrounding page has the project's standard scroll-reveal/focus-ring treatment, out of scope for this specific contract.

## Regression coverage

`apps/web/e2e/landing-contract.spec.ts` — 4 Playwright `toHaveScreenshot()` assertions (Reader/Annotations × desktop/mobile, Roadmap × desktop/mobile) against the checked-in Linux baselines in `apps/web/e2e/landing-contract.spec.ts-snapshots/`. Wired into the CI-safe spec list (`.github/workflows/ci.yml`'s `E2E (CI-safe specs)` step) as of Phase 22.1 (commit `7b34c57`), per the plan's own sequencing (the contract was frozen in Phase 19.4 and became a running gate once Phase 22's authenticated-surface parity work began). The four PNGs in this directory (`landing-reader-*.png`/`landing-annotations-*.png`/`landing-roadmap-*.png`) are byte-identical copies of the spec's own checked-in snapshots, regenerated from the same Docker runs whenever the spec's baselines change — they are a human-readable mirror, not an independently maintained second copy.

## Deliberate copy change — owner directive A (2026-07-22)

Per the owner's 2026-07-22 directive to remove all user-facing "AI" wording and instead explain each inference's basis, the Reader/Annotations showcase's lead paragraph (quoted above) was updated: "AI annotations" → "automated annotations" (parity with `EditionAnnotationsPanel`'s established "Automated annotations" filter option, commit `6bb5d80`). This is the one deliberate, owner-sanctioned exception to this document's otherwise-frozen contract, following the process the plan requires for any landing change: intentional copy edit + Docker-regenerated baselines (`reader-annotations-{desktop,mobile}-chromium-linux.png`, verified pixel-stable across 3 consecutive runs through the official `mcr.microsoft.com/playwright:v1.61.1-noble` image with zero diff) + this contract-doc update. The hero tagline ("Every AI-generated claim…" → "Every inferred claim…") and the Reliability section's provenance line ("AI annotations carry the model used…" → "Every automated annotation records the classification model or rule that produced it…") were changed at the same time but sit outside this document's screenshot scope (`Hero()`/`Reliability()`, not `ReaderShowcase()`/`RoadmapShowcase()`) — see `apps/web/src/app/page.tsx` and its sibling `apps/web/src/app/layout.tsx` (metadata description) for those. The Roadmap showcase's copy was untouched, which is why `roadmap-{desktop,mobile}-chromium-linux.png` are byte-identical to their pre-change versions.
