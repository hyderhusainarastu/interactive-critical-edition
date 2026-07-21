# Phase 15 handoff — Connected research web

Status: complete and tagged `phase-15-complete`; Phase 16 remains confirmation-gated.

- Migration `0026_phase15_research_web` is additive and applied locally plus production. Production Drizzle ledger: 27. It creates `research_resource_content` with cascading owner/run-source cleanup through `research_resource`.
- Worker eligibility is strict: explicit approved license metadata is required; a provider OA flag or public URL is not enough. Retrieval is bounded to HTML/plain text, 1.5 MB / 500k characters and 12 sources per run. It makes no model calls and preserves the $1/$5 research caps.
- Graph reads only published sources reached through the requesting owner’s documents. It has source types, provider/run/access/content provenance, deterministic source-to-source links, multi-work `pinnedWork` URL state, and one in-frame inspector shared by table and WebGL clicks.
- Validation passed: workspace typecheck and unit tests, web lint/build, focused 10-test Visualization Chromium suite, and 2-test authorization matrix. The `4bfdd9b` code rollout reached Vercel Ready (`dpl_7WV5K8bmjyk9JsXyvsuFxxGhZSzu`) and Render live (`dep-d9fuvmpoagis73bu4tcg`) before the final documentation-only sync; anonymous production graph checks are correctly login/401-gated. The full local browser run was also attempted; its worker-dependent upload flow lacked a running local worker and its graph-expansion fixture ran with the release flag disabled, so those environment-gated failures are not recorded as Phase 15 regressions.

Next: only begin Phase 16 after explicit confirmation. Do not touch or commit `research/` or `research.zip`.
