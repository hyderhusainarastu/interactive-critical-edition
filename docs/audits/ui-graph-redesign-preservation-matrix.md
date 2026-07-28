# UI/graph redesign preservation matrix — final-candidate update

**Candidate:** `c00b2bf`. The retained preparation comparison found no removed
baseline page routes between `6f9330c` and the redesign snapshot. The final
candidate adds the integrated Stage 7 test and repair work; it does not by
itself close the incomplete end-to-end preservation matrix.

| Capability / route family | Final-candidate disposition | Remaining final action |
| --- | --- | --- |
| Auth, onboarding, upload, duplicate/confirmation/retry, Trash | Preserved; guarded Trash delete passes retries=0 after removing pointer-moving hover tilt from its action row | Full multi-viewport matrix remains incomplete |
| Library search, filters, provenance, source upload | Preserved | Complete journey 3 matrix record |
| Reader, outline, apparatus, annotations, notes, bookmarks | Preserved; notes remain consolidated in one drawer | Complete journey 2 and keyboard record |
| `/works/[workId]/roadmap` | 2D stage-column Roadmap retained | Complete route/semantic keyboard check |
| Curriculum and diagnostic | Preserved | Record final smoke result |
| `/graph`, `/works/[workId]/graph` | Knowledge Map replacement; legacy URL browser chooser and mobile touch stress now pass with retries=0 | Complete journey 10 and remaining graph suite record |
| `/works/[workId]/sources` | Additive route | Confirm owned-work route and return navigation |
| Research projects/corpus/claims/corrections/debates | Preserved; project navigation and contextual Map links integrated | Complete journeys 4 and 6 |
| `/research/[projectId]/chambers`, `/research/[projectId]/graph` | Additive project-level routes | Confirm direct/deep-link behavior |
| Writer projects/documents/autosave/citations/export | Preserved; J07 and five focused autosave/concurrency regressions pass retries=0 | Full multi-viewport matrix remains incomplete |
| Ask Library and `/ask-library` | Preserved; Reader/shell controller presentation unified | Complete journey 8 and one-controller record |
| Account/profile/plan/usage/deletion and conditional Admin | Preserved | Complete journey 9 and authorization checks |

The final full route/deep-link and capability matrix is incomplete. This table
must not be used to waive the remaining journeys or the manual VoiceOver
requirement.
