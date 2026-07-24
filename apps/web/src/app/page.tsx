import Link from "next/link";
import { isBetaTestingMode } from "@ice/config";
import { AskLibraryDepiction } from "@/components/site/AskLibraryDepiction";
import { InteractiveGraphRendering } from "@/components/site/InteractiveGraph";
import { DOCUMENTATION_URL } from "@/components/site/links";
import { Mark } from "@/components/site/Mark";
import { AnnotationsRendering, LibraryRendering, ProductScope } from "@/components/site/ProductDepictions";
import { PublicExperience } from "@/components/site/PublicExperience";
import { SiteFooter } from "@/components/site/SiteFooter";
import { SiteHeader } from "@/components/site/SiteHeader";
import { auth } from "@/lib/auth";
import { SITE_NAME } from "@/lib/brand";
import "./site-theme.css";

/**
 * Public landing page.
 *
 * Structure, typography, and palette are adapted from the owner's
 * campaign site; all campaign-specific content (funding goal, use of
 * funds, twelve-month roadmap, reward tiers, backer FAQ) is deliberately
 * absent — this page describes the application, nothing else.
 *
 * Everything renders inside `.pal-site`, which scopes the entire campaign
 * stylesheet (apps/web/src/app/site-theme.css) and re-points the app's
 * `--color-*` tokens at the campaign palette. Nothing here can reach the
 * signed-in workspace.
 *
 * Copy discipline: every capability claim below is one the system
 * actually delivers today, and each is stated with its own limits rather
 * than as a promise. No user-facing "AI" wording (standing rule
 * D-22-23) — the basis for an inference is described instead.
 */

const routeItems = [
  {
    when: "Orient",
    title: "Name the question",
    reason: "Locate the central problem, your reader level, and the concepts that need attention first.",
    meta: "Checkpoint · 12 min · All levels",
    tone: "green",
  },
  {
    when: "Prepare",
    title: "Build the prerequisites",
    reason: "Read only the background works and sections the primary argument actually depends upon.",
    meta: "Essential · 38 min · Foundational",
    tone: "blue",
  },
  {
    when: "Read",
    title: "Return to the primary work",
    reason: "Move through the anchored passages with notes, footnotes, and evidence in reach.",
    meta: "Core · 52 min · Primary",
    tone: "burgundy",
  },
  {
    when: "Interpret",
    title: "Stage competing readings",
    reason: "Place strong interpretations alongside disagreements without collapsing them into one verdict.",
    meta: "Recommended · 34 min · Advanced",
    tone: "blue",
  },
  {
    when: "Synthesize",
    title: "Test what you now understand",
    reason: "Use a checkpoint to update concept mastery and turn completed sources into review material.",
    meta: "Checkpoint · 15 min · Review",
    tone: "burgundy",
  },
];

const integrityPoints: Array<[string, string]> = [
  [
    "Evidence before authority",
    "An explicit citation, a scholarly interpretation, an inferred relation, and a contested reading never look identical in the interface.",
  ],
  [
    "No invented sources",
    "Title, author, year, and DOI come only from a real catalogue match — Crossref, OpenAlex, Open Library, Google Books, Semantic Scholar. A citation that cannot be matched stays visibly unresolved instead of guessed.",
  ],
  [
    "Provenance on every claim",
    "Each generated annotation records the rule or model that produced it, its version, its confidence, and the verbatim passage that triggered it. Deterministic fallbacks are labelled as such end to end.",
  ],
  [
    "Popularity is context, not credit",
    "Views, likes, downloads, and citation counts are recorded and displayed. They never raise a source's evidential standing.",
  ],
  [
    "Correction is part of the method",
    "Approve, dispute, edit, or hide anything. An explanation you rewrite is reattributed to you and is not left credited to the system.",
  ],
  [
    "Your data is yours",
    "Per-user isolation throughout: a request for something you don't own returns not-found rather than revealing it exists. Uploads are yours to delete, and content is never used to train models without an explicit, separate opt-in.",
  ],
];

const faqs: Array<[string, string]> = [
  [
    "Is Palimnote working today?",
    "Yes. Upload and structural extraction, citation resolution, passage-anchored annotation, the Library, curriculum routes, the knowledge graph, and Ask Library all run against real documents. Registration is closed while a small group tests; some capabilities remain behind release flags and are not visible to readers yet.",
  ],
  [
    "Does it replace reading the primary text?",
    "No. The original text stays central, and every route built around it should lead back to it. The apparatus exists so that a difficult passage becomes readable, not so it can be skipped.",
  ],
  [
    "Where do the annotations come from?",
    "Citations are extracted by deterministic passes over bibliographies, inline author–year forms, and the footnote-only conventions common in humanities scholarship, then matched against real bibliographic catalogues. Only the relationship between a reference and the passage is classified; the reference itself is never composed.",
  ],
  [
    "Will it find every relevant relationship?",
    "No. Discovery runs under explicit numeric ceilings, so it can be incomplete, and interpretation can be legitimately contested. Those limits and the paths for correcting them are part of the design rather than fine print.",
  ],
  [
    "How are sources judged?",
    "Publication rigor, creator expertise, host provenance, evidence strength, relevance, pedagogical value, peer-review state, and traceability stay separate and separately labelled. They are never collapsed into one universal score.",
  ],
  [
    "What can Ask Library actually answer?",
    "Only what it can retrieve from your own library — your uploads, plus sources held under an explicit open licence. A substantive answer must carry the passage it came from; a question with no supporting evidence gets an explicit not-found.",
  ],
  [
    "What happens to what I upload?",
    "It is scoped to your account and never visible to another reader. Deleting your account removes the files, the extracted text, and everything derived from them — not just the account record. See Privacy & copyright for the detail.",
  ],
];

export default async function Home() {
  const session = await auth();
  const signedIn = Boolean(session?.user?.id);
  const betaTestingMode = isBetaTestingMode();

  const primaryHref = signedIn ? "/dashboard" : betaTestingMode ? "/login" : "/signup";
  const primaryLabel = signedIn ? "Open your library" : betaTestingMode ? "Log in to the beta" : "Start reading";

  return (
    <div className="pal-site pal-landing">
      <SiteHeader />
      <PublicExperience />
      <main id="top">
        <section className="hero section-shell" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="kicker">The map in the margins · {SITE_NAME}</p>
            <h1 id="hero-title" className="hero-title" aria-label="A Text Is Never Alone">
              <span aria-hidden="true">A Text{" "}</span>
              <span aria-hidden="true">Is Never{" "}</span>
              <span aria-hidden="true">Alone</span>
            </h1>
            <p className="hero-deck">
              Upload a difficult scholarly work. {SITE_NAME} builds a traceable critical edition around it — then turns
              its sources, concepts, debates, and evidence into a Library, a reading route, an explorable intellectual
              map, and a chat that answers only from what you actually hold.
            </p>
            <div className="hero-actions">
              <Link className="button button-primary app-press" data-magnetic href={primaryHref}>
                {primaryLabel}
              </Link>
              <a className="text-link" href="#graph">
                Try the 3D graph <span aria-hidden="true">↓</span>
              </a>
            </div>
            <p className="hero-note">
              {betaTestingMode ? "Beta testing · " : ""}Read deeply. See the whole conversation.
            </p>
          </div>

          <div className="hero-visual" aria-label="Layered annotated manuscript">
            <div className="paper-sheet paper-sheet-ghost paper-sheet-ghost-back" data-parallax-depth="0.9" aria-hidden="true" />
            <div className="paper-sheet paper-sheet-ghost paper-sheet-ghost-mid" data-parallax-depth="0.55" aria-hidden="true" />
            <div className="paper-sheet paper-sheet-primary" data-parallax-depth="0.24">
              <div className="folio">PAL / 01</div>
              <div className="text-lines" aria-hidden="true">
                <i />
                <i />
                <i />
                <i />
                <i className="selected" />
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
              </div>
              <div className="active-bracket" aria-hidden="true" />
              <div className="margin-note margin-note-a">
                <b>01</b>
                <span>Inherited concept</span>
              </div>
              <div className="margin-note margin-note-b">
                <b>02</b>
                <span>Earlier work</span>
              </div>
              <div className="margin-note margin-note-c">
                <b>03</b>
                <span>Contested reading</span>
              </div>
              <div className="paper-caption">Begin with the passage.</div>
            </div>
          </div>
        </section>

        <section className="premise band" aria-labelledby="premise-title">
          <div className="section-shell premise-grid">
            <p className="section-index">01 / The problem</p>
            <div>
              <h2 id="premise-title">The hardest texts rarely arrive with a map.</h2>
              <div className="two-column-copy">
                <p>
                  The sentence may be clear word by word, yet the argument still seems to begin somewhere else. It
                  assumes a debate you have not encountered, inherits a contested concept, or answers a figure never
                  fully introduced.
                </p>
                <p>
                  Experienced readers carry much of that surrounding structure implicitly. A beginner is usually given
                  the text without the map. {SITE_NAME} recovers and organizes that structure, while keeping every
                  explanation anchored to the passage and every source in its proper evidential role.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section id="workspace" className="scope section-shell" aria-labelledby="scope-title">
          <div className="section-head">
            <div>
              <p className="section-index">02 / The complete workspace</p>
              <h2 id="scope-title">From an uploaded text to a world you can study.</h2>
            </div>
            <p>One system joins the critical edition, what you already know, and the wider research field around it.</p>
          </div>
          <ProductScope />
          <div className="pipeline-strip" aria-label={`${SITE_NAME} product flow`}>
            <span>
              <b>01</b> Upload
            </span>
            <i />
            <span>
              <b>02</b> Recover structure
            </span>
            <i />
            <span>
              <b>03</b> Resolve citations
            </span>
            <i />
            <span>
              <b>04</b> Assess credibility
            </span>
            <i />
            <span>
              <b>05</b> Read in context
            </span>
          </div>
        </section>

        <section id="reader" className="method annotations-section band" aria-labelledby="method-title">
          <div className="section-shell">
            <div className="section-head">
              <div>
                <p className="section-index">03 / The annotated reader</p>
                <h2 id="method-title">One passage. Different kinds of knowledge.</h2>
              </div>
              <p>
                Peer-reviewed scholarship, expert teaching, and public discussion can all matter — without pretending
                they carry the same authority.
              </p>
            </div>
            <AnnotationsRendering />

            <div className="source-spectrum">
              <div>
                <small>DISCOVERY COVERAGE</small>
                <b>Scholarly</b>
                <span>Crossref · OpenAlex · Semantic Scholar · Open Library · Google Books</span>
              </div>
              <div>
                <small>TEACHING &amp; WEB</small>
                <b>Public knowledge</b>
                <span>Inspected web sources · recorded lectures · verified creator context</span>
              </div>
              <div>
                <small>SOCIAL RECEPTION</small>
                <b>Discussion</b>
                <span>Optional social adapters, reported honestly when a provider is unavailable</span>
              </div>
            </div>

            <div className="principles-grid">
              <article>
                <span>01</span>
                <h3>Begin locally</h3>
                <p>Context opens where the difficulty occurs, with the original passage kept in view.</p>
              </article>
              <article>
                <span>02</span>
                <h3>Separate credibility</h3>
                <p>
                  Rigor, expertise, provenance, evidence, relevance, pedagogy, and popularity remain distinct
                  dimensions.
                </p>
              </article>
              <article>
                <span>03</span>
                <h3>Keep sources in role</h3>
                <p>A social post may reveal a question. It never silently becomes scholarly evidence.</p>
              </article>
            </div>
          </div>
        </section>

        <section className="route band" aria-labelledby="route-title">
          <div className="section-shell">
            <div className="section-head">
              <div>
                <p className="section-index">04 / Roadmap and curriculum</p>
                <h2 id="route-title">A reading order, not a pile of citations.</h2>
              </div>
              <p>
                Every reference is ranked into dependency-ordered priority tiers, recomputed on each request so a new
                rating can never leave a stale plan behind.
              </p>
            </div>
            <div className="curriculum-modes">
              <span>Route depth</span>
              <span className="mode">Minimal</span>
              <span className="mode active">University</span>
              <span className="mode">Graduate</span>
              <span>Reader level · Advanced</span>
            </div>
            <div className="route-list">
              {routeItems.map((item, index) => (
                <article className={`route-card route-${item.tone}`} key={item.when}>
                  <div className="route-step">
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <b>{item.when}</b>
                  </div>
                  <div>
                    <h3>{item.title}</h3>
                    <p>{item.reason}</p>
                  </div>
                  <div className="route-meta">{item.meta}</div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="library" className="showcase-section section-shell" aria-labelledby="library-title">
          <div className="section-head">
            <div>
              <p className="section-index">05 / The Library</p>
              <h2 id="library-title">Every source. One remembered reason.</h2>
            </div>
            <p>
              Sources arrive from uploads, citations, recommendations, lectures, web research, and public discussion —
              then resolve into a canonical, filterable reading world.
            </p>
          </div>
          <LibraryRendering />
        </section>

        <section id="graph" className="showcase-section graph-section" aria-labelledby="graph-title">
          <div className="section-shell">
            <div className="section-head inverse">
              <div>
                <p className="section-index">06 / The knowledge graph</p>
                <h2 id="graph-title">See every kind of relation — not just a cloud of links.</h2>
              </div>
              <p>
                Rotate, zoom, and inspect. Works remain the backbone; people, concepts, traditions, debates, sections,
                and passages explain the conversation. An accessible list carries the identical data.
              </p>
            </div>
            <InteractiveGraphRendering />
          </div>
        </section>

        <section id="ask" className="showcase-section chat-section section-shell" aria-labelledby="ask-title">
          <div className="section-head">
            <div>
              <p className="section-index">07 / Ask Library</p>
              <h2 id="ask-title">Answers that have to show where they came from.</h2>
            </div>
            <p>
              A question is answered from passages retrieved out of your own library, in a Socratic register: what the
              evidence supports, then one question you can use to test it.
            </p>
          </div>
          <AskLibraryDepiction />
        </section>

        <section className="status-section section-shell" aria-labelledby="status-title">
          <div className="section-head">
            <div>
              <p className="section-index">08 / Honest status</p>
              <h2 id="status-title">Built and running. Still earning its trust.</h2>
            </div>
            <p>
              The system is in use against real documents. What follows says plainly which parts you can rely on today
              and which are still being measured.
            </p>
          </div>
          <div className="status-grid">
            <article>
              <span className="status status-green">In use now</span>
              <h3>The critical-edition engine</h3>
              <p>
                Page-aware ingestion, structural extraction of body prose and apparatus, multi-source discovery,
                credibility assessment, versioned processing runs, and traceable critical notes with bounded processing.
              </p>
            </article>
            <article>
              <span className="status status-umber">In use now</span>
              <h3>The reading workspace</h3>
              <p>
                Reader, passage-anchored annotations, four reader levels, concept mastery, the Library, curriculum
                routes, notes, split-pane reading, the knowledge graph, and Ask Library.
              </p>
            </article>
            <article>
              <span className="status status-burgundy">Beta testing</span>
              <h3>What the beta is for</h3>
              <p>
                Registration is closed while a small group tests. Some capabilities stay behind release flags and are
                not visible to readers yet; resolution accuracy and accessibility are still being measured in the open.
              </p>
            </article>
          </div>
          <div className="not-promise">
            <p className="section-index">What this will not promise</p>
            <p>
              Instant mastery, perfect interpretation, exhaustive discovery, error-free processing, access to
              copyrighted works you do not already hold, or the replacement of expert judgment.
            </p>
          </div>
        </section>

        <section id="integrity" className="integrity band" aria-labelledby="integrity-title">
          <div className="section-shell">
            <div className="section-head inverse">
              <div>
                <p className="section-index">09 / Built for scrutiny</p>
                <h2 id="integrity-title">Uncertainty belongs in the interface.</h2>
              </div>
              <p>
                The standard is not that the system never makes a mistake. It is that unsupported certainty should not
                be designed into the experience.
              </p>
            </div>
            <div className="integrity-grid">
              {integrityPoints.map(([title, copy]) => (
                <article key={title}>
                  <h3>{title}</h3>
                  <p>{copy}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="faq section-shell" aria-labelledby="faq-title">
          <div className="faq-intro">
            <p className="section-index">10 / Questions</p>
            <h2 id="faq-title">The short answers.</h2>
            <p>Clear limits are part of the product, not fine print added later.</p>
          </div>
          <div className="faq-list">
            {faqs.map(([question, answer], index) => (
              <details key={question} open={index === 0}>
                <summary>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  {question}
                </summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section id="closing" className="closing" aria-labelledby="closing-title">
          <div className="section-shell closing-inner">
            <Mark />
            <p className="section-index">Start here</p>
            <h2 id="closing-title">Bring the hardest thing on your shelf.</h2>
            <p>
              Turn a difficult text into a traceable critical edition — its sources resolved, its debates staged, its
              evidence in reach, and every inference answerable for itself.
            </p>
            <div className="closing-actions">
              <Link className="button button-light app-press" data-magnetic href={primaryHref}>
                {primaryLabel}
              </Link>
              <a
                className="button button-ghost app-press"
                data-magnetic
                href={DOCUMENTATION_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                Read the full documentation <span aria-hidden="true">↗</span>
              </a>
            </div>
            <div className="closing-meta">
              <span>A text is never alone</span>
              <span>Read deeply. See the whole conversation.</span>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
