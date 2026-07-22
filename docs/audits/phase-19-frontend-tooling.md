# Phase 19 Frontend Tooling Audit

Per §3.6/§3.7/§19.2 of `palimnote_phases_19_23_plan_revised.md`. Both mandated tools were checked for real availability before any substitution — neither was silently skipped.

## Stitch MCP

**Status: installed but non-functional in this environment.**

`mcp__stitch__list_projects` and `mcp__stitch__list_design_systems` were called first, as required (§3.7 step 1). Both returned:

```
Incompatible auth server: does not support dynamic client registration
```

This is an OAuth-configuration failure on the connected MCP server, not a usage error — no project/design-system list could be retrieved, so no existing Palimnote Stitch project could be inspected or reused, and no screen generation could occur through this tool. Retried once (same result); not re-attempted further per the plan's own instruction not to reinstall/replace an already-configured server, only to substitute when it doesn't work.

**Substitution used instead:** the project's own repository-derived design tokens (Tailwind config, `globals.css` custom properties documented throughout `docs/PROJECT-LOG.md`'s Design Decisions table — credibility accent tokens, `CATEGORY_META` color mapping, focus-ring/contrast tokens) are the design system of record, since they are literally what ships. Screen exploration for the bounded variant set the plan calls for (§3.7 step 7: Library search/empty states, Trash confirmation, metadata-only upload, Visualization controls/inspector, Reader/Annotations/Roadmap parity, RAG sidebar, responsive/empty/error states) will be done as static HTML/CSS comparison mockups reviewed via Playwright screenshot diffing against the protected landing-page baseline (Phase 19.4), rather than through Stitch's generator. This keeps the same "compare bounded variants before implementing" discipline the plan requires, without inventing a tool that isn't reachable.

`docs/design/palimnote-design.md` (required by §3.7 step 4) will still be built from the real repository tokens regardless of Stitch's availability, since it documents ground truth the codebase already has, not something Stitch would have generated.

## Uncodixify

**Status: not a recognized/installable plugin in this environment.**

The environment's plugin/tool registry (`ToolSearch`) was queried for "uncodixify" — no match, deferred or otherwise. There is no plugin-management CLI in this Node/pnpm monorepo (no `.claude/plugins`, no equivalent marketplace command) that resolves this identifier. Per §3.6 step 2/9's own requirement to inspect permissions/compatibility before installing, and the plan's own fallback instruction ("If the plugins also don't work, find an alternative frontend design tool"), no package was guessed or force-installed.

**Substitution used instead — the smallest set that covers Uncodixify's stated purpose categories (§3.6 step 7), all already present or addable with zero new supply-chain surface beyond what's already audited in this repo:**

| Category | Tool | Status |
|---|---|---|
| Accessibility / WCAG auditing | `@axe-core/playwright` | Already in use (landing a11y suite, Phase 6/7). Extended in Phase 19.8 to authenticated routes. |
| Next.js/React review | `eslint` + `eslint-config-next` (already the project's lint baseline) | Already in use; no new plugin needed. |
| Responsive-layout testing | Playwright's device-viewport matrix (`320/375/768/1024/1280/1440`, §23.3) | Native Playwright capability, no plugin. |
| Visual-regression / screenshot comparison | Playwright's built-in `toHaveScreenshot()` | Already the mechanism specified for the Phase 19.4 landing-contract freeze; extended, not replaced. |
| Design-system/token consistency | Manual audit against `docs/design/palimnote-design.md` (repository-derived, see above) | New doc, no new tool. |
| Motion/reduced-motion review | Manual `prefers-reduced-motion` matrix pass + Playwright `page.emulateMedia({ reducedMotion: 'reduce' })` | Native Playwright capability. |
| Performance / bundle analysis | `next build` output (route-level bundle sizes already printed) + Lighthouse via Chrome DevTools if needed | Already available via the standard build step. |

No new npm dependency was added for this substitution — everything above is either already a project dependency or a native Playwright/Next.js capability. This avoids the exact anti-pattern the plan itself warns against in §3.6 step 8 ("avoid redundant plugins that perform the same task") while still covering every category Uncodixify was meant to serve.

## Decision log

Both substitutions are recorded here rather than silently applied, per §3.5's prohibition on claiming a tool was used when it wasn't. Findings from the substituted tools will be dispositioned into the Phase 19 defect register (`docs/audits/phase-19-product-audit.md`) exactly as Uncodixify/Stitch findings would have been, under the same accept/reject criteria in §3.6 step 6 and §22.1.
