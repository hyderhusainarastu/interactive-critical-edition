# Phase 16 handoff — Reliable processing and Interactive Reader

Status: complete and tagged `phase-16-complete`; Phase 17 remains confirmation-gated.

- Migration `0027_phase16_reliable_reader` is additive and applied locally plus production (Drizzle ledger 28). It adds `text_block.marker` and the `endnote` structural kind.
- The immutable original is the **Published edition** (PDF or source text); the **Interactive reader** is continuous processed prose only, with outline and source-page/block position navigation. Structure-limited fallback is explicit and cannot duplicate apparatus into body text.
- Footnotes/endnotes/bibliography/captions remain separately persisted, page/block anchored, and labelled in the linked Footnotes apparatus. Annotation evidence shows source, confidence, and provenance; desktop notes expand on hover/focus and narrow screens use accessible inline details.
- Verification passed: ingestion 36 tests, all workspace unit tests, relevant typechecks, web lint/build, and the 11-flow focused reader Chromium suite. The complete historical browser matrix was not used as the Phase 16 acceptance gate because its worker-dependent upload paths require a separately running local worker; its Phase 16 targeted reader suite passed.
- Production: migration applied before code rollout; Vercel deployment `interactive-critical-edition-a4efabi78.vercel.app` is Ready and Render `dep-d9fvfqn41pts73elj0h0` is live on `e3c1f4f`. One production PDF canary completed full structure for $0.0845135 (116 body blocks, 4 separate footnotes, 13 apparatus records, page/block anchors, zero footnote-body duplicate matches). Its owner, work/document/run, Storage object, queue rows, temporary credential, and session artifacts were removed and their absence verified.

Next: obtain explicit confirmation before beginning Phase 17. Do not touch, commit, or deploy `research/` or `research.zip`.
