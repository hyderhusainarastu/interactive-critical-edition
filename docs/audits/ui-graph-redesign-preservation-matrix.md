# UI/graph redesign preservation matrix — pre-final comparison

**Comparison boundary:** baseline `6f9330c` to pre-final redesign snapshot
`4e779e6`, reconstructed from the retained Stage 7 preparation audit. This
is a preservation checklist for final integration, not proof about any later
commit.

| Capability / route family | Pre-final disposition | Final-tree action |
| --- | --- | --- |
| Auth, onboarding, upload, duplicate/confirmation/retry, Trash | Preserved routes and workflow surfaces | Re-run journey 1 |
| Library search, filters, provenance, source upload | Preserved | Re-run journey 3 |
| Reader, outline, apparatus, annotations, notes, bookmarks | Preserved; notes presentation consolidated into one drawer | Re-run journey 2 and keyboard checks |
| `/works/[workId]/roadmap` | Intentionally replaced 3D constellation with 2D stage-column roadmap | Re-run route and semantic keyboard checks |
| Curriculum and diagnostic | Preserved | Smoke route checks |
| `/graph`, `/works/[workId]/graph` | Intentionally replaced with Knowledge Map; legacy codec retained | Re-run journey 10 plus graph suite |
| `/works/[workId]/sources` | Additive route | Confirm owned-work route and return navigation |
| Research projects/corpus/claims/corrections/debates | Preserved; project navigation and contextual Map links added | Re-run journeys 4 and 6 |
| `/research/[projectId]/chambers` and `/graph` | Additive project-level routes | Confirm direct/deep-link behavior |
| Writer projects/documents/autosave/citations/export | Preserved; focused panels and insertion affordances added | Re-run journey 7 |
| Ask Library and `/ask-library` | Preserved; Reader/shell controller presentation intentionally unified | Re-run journey 8 and one-controller assertions |
| Account/profile/plan/usage/deletion and conditional Admin | Preserved | Re-run journey 9 and authorization checks |

No baseline page route was reported removed by the preparation comparison.
The final integrator must repeat the route/deep-link check after all pending
commits land; this table must not be used to waive it.
