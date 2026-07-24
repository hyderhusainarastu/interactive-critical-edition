"use client";

import { useState } from "react";

/**
 * Product depictions for the public landing page, ported from the owner's
 * campaign site (`palimnote-campaign/app/ProductShowcase.tsx`).
 *
 * These are illustrative interface renderings, not screenshots and not
 * live data — each frame says so in its own footnote. Two categories of
 * edit were made against the source, both recorded rather than silent:
 *
 *   - Chrome badges that read "Working product · Phase 9" now read
 *     "Working product · Beta"; the app has shipped well past that phase
 *     and the landing page is under a beta-testing banner.
 *   - `role="cell"` / `role="columnheader"` were added to the Library
 *     table's cells. `role="row"` requires cell children, and without
 *     them axe's `aria-required-children` (wcag2a) fails, which would
 *     break the zero-violation gate in apps/web/e2e/landing.spec.ts.
 *
 * ProductScope's eight cards are rewritten against the current product
 * rather than ported: the campaign's copy predates the Library identity
 * work, the Ask Library chat, and Writer mode. Wording follows the
 * project's standing no-"AI" rule (D-22-23) — describe the basis of an
 * inference, don't invoke the technology.
 */

const sources = [
  {
    id: "peer",
    kind: "Peer-reviewed article",
    title: "Scholarly analysis of practical wisdom and moral failure",
    creator: "Journal article · full text inspected",
    relation: "Interpretive aid",
    rationale: "Clarifies the article’s account of how practical judgment can fail without reducing the issue to ignorance.",
    authority: "A",
    score: 92,
    level: "Research",
    status: "Reading",
    reviewed: true,
  },
  {
    id: "lecture",
    kind: "University lecture",
    title: "Professor-led lecture on Aristotle and virtue ethics",
    creator: "Verified professor · university YouTube channel",
    relation: "Prerequisite",
    rationale: "Offers a strong pedagogical introduction to the conceptual background of the selected passage.",
    authority: "B",
    score: 81,
    level: "Undergraduate",
    status: "To read",
    reviewed: false,
  },
  {
    id: "social",
    kind: "Public discussion",
    title: "Social post asking whether vice is a failure of reason",
    creator: "Public social source · creator expertise unverified",
    relation: "Contemporary reception",
    rationale: "Surfaces a recurring reader confusion; retained as a research lead, never as sole factual evidence.",
    authority: "D",
    score: 39,
    level: "All levels",
    status: "Unreviewed",
    reviewed: false,
  },
  {
    id: "primary",
    kind: "Primary source",
    title: "Nicomachean Ethics",
    creator: "Canonical work · bibliographic identity resolved",
    relation: "Essential background",
    rationale: "Supplies the account of virtue, choice, and practical reason presupposed by the central argument.",
    authority: "A",
    score: 98,
    level: "Undergraduate",
    status: "Completed",
    reviewed: false,
  },
  {
    id: "book",
    kind: "Academic-press book",
    title: "Historical study of Vico’s moral and political thought",
    creator: "Academic press · metadata and relevant chapter inspected",
    relation: "Historical context",
    rationale: "Locates the argument within Vico’s account of institutions, custom, and human making.",
    authority: "A",
    score: 89,
    level: "Advanced",
    status: "To read",
    reviewed: false,
  },
  {
    id: "reference",
    kind: "Reference work",
    title: "Concept entry: practical wisdom",
    creator: "Scholarly reference · entry inspected",
    relation: "Conceptual context",
    rationale: "Provides a concise orientation before the more demanding primary and secondary sources.",
    authority: "B",
    score: 84,
    level: "Beginner",
    status: "Completed",
    reviewed: false,
  },
];

const annotationDetails = {
  peer: {
    glyph: "◆",
    label: "Peer-reviewed scholarship",
    source: "Scholarly analysis of practical wisdom and moral failure",
    summary: "A peer-reviewed interpretation distinguishes failures of deliberation from failures of attention and formation.",
    authority: "A",
    confidence: "92%",
    review: "Peer reviewed",
    inspection: "Full text inspected",
    creator: "Verified scholarly authorship",
    evidence: "Strong, passage-relevant",
    use: "May support a scholarly claim with the inspected passage.",
  },
  lecture: {
    glyph: "▶",
    label: "Professor lecture",
    source: "University lecture on Aristotle and virtue ethics",
    summary: "A verified professor explains the conceptual background clearly, making it useful for orientation before primary reading.",
    authority: "B",
    confidence: "84%",
    review: "Not peer reviewed",
    inspection: "Transcript inspected",
    creator: "Professor identity verified",
    evidence: "Good pedagogical support",
    use: "Useful for teaching and orientation; not treated as peer-reviewed publication.",
  },
  social: {
    glyph: "#",
    label: "Public discussion",
    source: "Social post on vice and rational failure",
    summary: "A public post identifies a genuine reader confusion, but its creator and evidence are not sufficient for factual support.",
    authority: "D",
    confidence: "61% relevance",
    review: "Not peer reviewed",
    inspection: "Post and thread inspected",
    creator: "Expertise unverified",
    evidence: "Weak; supplementary only",
    use: "Retained as a question or reception signal; never sole support for a factual note.",
  },
};

export function AnnotationsRendering() {
  const [selected, setSelected] = useState<keyof typeof annotationDetails>("peer");
  const current = annotationDetails[selected];

  return (
    <div className="product-frame annotation-rendering">
      <div className="app-chrome">
        <div className="app-brand"><span className="app-mark">P</span><b>Palimnote</b></div>
        <div className="work-tabs"><span className="active">Reader</span><span>Curriculum</span><span>Bibliography</span><span>Graph</span><span>Notes</span></div>
        <span className="demo-badge">Working product · Beta</span>
      </div>
      <div className="annotation-layout">
        <aside className="reader-nav">
          <b>Vice and Reason</b>
          <span>Outline</span>
          <span className="nav-row active">§ 3 · Practical judgment</span>
          <span className="nav-row">§ 4 · Moral formation</span>
          <span className="nav-row">Notes &amp; footnotes</span>
          <div className="reader-level"><span>Reader level</span><b>Advanced</b><small>Show all levels</small></div>
        </aside>
        <article className="demo-reader">
          <div className="reader-toolbar"><span>Page 14 of 27</span><span>A− &nbsp; A+ &nbsp; Focus</span></div>
          <p className="chapter-label">III · PRACTICAL JUDGMENT</p>
          <h3>Reason, action, and the formation of character</h3>
          <p>The difficulty is not simply that judgment lacks information. Practical reason acts within a world already shaped by habit, language, and inherited accounts of the good.</p>
          <p className="demo-highlight peer-highlight">The failure of judgment may therefore concern not only what a person knows, but what a person has become capable of seeing.<button aria-label="Open peer-reviewed annotation" onClick={() => setSelected("peer")}>◆</button></p>
          <p>This is why a strictly intellectual correction may leave the central difficulty untouched. The argument asks how reason is educated by practices that precede reflection.</p>
          <p className="demo-highlight lecture-highlight">A reader encountering this vocabulary for the first time may need the earlier account of virtue and practical wisdom.<button aria-label="Open university lecture annotation" onClick={() => setSelected("lecture")}>▶</button></p>
          <p className="demo-highlight social-highlight">Contemporary readers often restate the problem as a conflict between knowledge and motivation.<button aria-label="Open public-discussion annotation" onClick={() => setSelected("social")}>#</button></p>
          <div className="authorial-note"><b>1</b><span>Authorial note preserved from the uploaded edition and visually distinct from generated commentary.</span></div>
        </article>
        <aside className="annotation-panel" aria-live="polite">
          <div className="panel-heading"><div><span>Scholarly analysis</span><b>3 sources at this passage</b></div><span>Complete</span></div>
          <div className="research-warning">Research aid — every claim carries confidence, provenance, and limits.</div>
          <div className="annotation-source-switcher" role="group" aria-label="Choose annotation source">
            {(Object.keys(annotationDetails) as Array<keyof typeof annotationDetails>).map((id) => {
              const item = annotationDetails[id];
              return <button key={id} type="button" aria-pressed={selected === id} onClick={() => setSelected(id)}><span>{item.glyph}</span><b>{item.label}</b><small>Authority {item.authority}</small></button>;
            })}
          </div>
          <div className={`annotation-detail annotation-${selected}`}>
            <div className="annotation-title"><span>{current.glyph}</span><div><small>{current.label}</small><h4>{current.source}</h4></div><b>Authority {current.authority}</b></div>
            <p>{current.summary}</p>
            <dl>
              <div><dt>Confidence</dt><dd>{current.confidence}</dd></div>
              <div><dt>Publication</dt><dd>{current.review}</dd></div>
              <div><dt>Inspection</dt><dd>{current.inspection}</dd></div>
              <div><dt>Creator</dt><dd>{current.creator}</dd></div>
              <div><dt>Evidence</dt><dd>{current.evidence}</dd></div>
            </dl>
            <div className="source-use"><b>How Palimnote may use it</b><span>{current.use}</span></div>
            <div className="annotation-actions"><span>Verify</span><span>Dispute</span><span>Edit</span><span>Hide</span></div>
          </div>
        </aside>
      </div>
      <div className="demo-footnote">Illustrative interface rendering · Source titles are descriptive, not fabricated citations.</div>
    </div>
  );
}

type LibraryTab = "All" | "To read" | "Reading" | "Completed";

export function LibraryRendering() {
  const [tab, setTab] = useState<LibraryTab>("All");
  const [level, setLevel] = useState("All levels");
  const visible = sources.filter((source) => (tab === "All" || source.status === tab) && (level === "All levels" || source.level === level || source.level === "All levels"));

  return (
    <div className="product-frame library-rendering">
      <div className="app-chrome">
        <div className="app-brand"><span className="app-mark">P</span><b>Palimnote</b></div>
        <div className="global-nav"><span>Dashboard</span><span>Works</span><span className="active">Library</span><span>Graph</span><span>Upload</span></div>
        <span className="demo-badge">Working product · Beta</span>
      </div>
      <div className="library-shell">
        <div className="library-header">
          <div><small>YOUR RESEARCH WORLD</small><h3>Library</h3><p>Every source recommended for your works, grouped once and kept with the reason it matters.</p></div>
          <div className="library-count"><b>48</b><span>canonical sources</span></div>
        </div>
        <div className="library-tabs" role="group" aria-label="Filter by reading status">
          {(["All", "To read", "Reading", "Completed"] as LibraryTab[]).map((item) => <button key={item} type="button" aria-pressed={tab === item} onClick={() => setTab(item)}>{item}<span>{item === "All" ? 48 : item === "To read" ? 31 : item === "Reading" ? 6 : 11}</span></button>)}
        </div>
        <div className="library-filters">
          <label>Relationship<select defaultValue="All relationships"><option>All relationships</option><option>Prerequisite</option><option>Interpretive aid</option><option>Historical context</option></select></label>
          <label>Source type<select defaultValue="All source types"><option>All source types</option><option>Peer-reviewed</option><option>University lecture</option><option>Public discussion</option></select></label>
          <label>Reader level<select value={level} onChange={(event) => setLevel(event.target.value)}><option>All levels</option><option>Beginner</option><option>Undergraduate</option><option>Advanced</option><option>Research</option></select></label>
          <label>Sort<select defaultValue="Credibility"><option>Credibility</option><option>Recently added</option><option>Title A–Z</option></select></label>
          <span>{visible.length} shown</span>
        </div>
        <div className="library-table" role="table" aria-label="Illustrative Palimnote Library">
          <div className="library-table-head" role="row"><span role="columnheader">Source &amp; reason</span><span role="columnheader">Relationship</span><span role="columnheader">Credibility</span><span role="columnheader">Reading state</span></div>
          {visible.map((source) => (
            <div className="library-row" role="row" key={source.id}>
              <div role="cell"><span className={`source-icon source-${source.id}`}>{source.id === "lecture" ? "▶" : source.id === "social" ? "#" : source.id === "peer" ? "◆" : "§"}</span><div><b>{source.title}</b><small>{source.creator}</small><p>{source.rationale}</p><em>Recommended for: Vice and Reason</em></div></div>
              <span role="cell"><b>{source.relation}</b><small>{source.kind}</small></span>
              <span role="cell" className="credibility"><b className={`grade grade-${source.authority.toLowerCase()}`}>{source.authority}</b><span><strong>{source.score}/100</strong><small>{source.reviewed ? "Peer reviewed" : source.id === "social" ? "Supplementary only" : "Role labelled"}</small></span></span>
              <span role="cell" className={`reading-state state-${source.status.toLowerCase().replace(" ", "-")}`}>{source.status}<span>⌄</span></span>
            </div>
          ))}
        </div>
        <div className="library-note"><b>One identity, many entry points.</b><span>Uploads, citations, recommendations, lectures, saved sources, and missing works resolve into canonical records without losing provenance.</span></div>
      </div>
      <div className="demo-footnote">Interactive rendering · Try the reading-state tabs and reader-level filter.</div>
    </div>
  );
}

export function ProductScope() {
  const items: Array<[string, string, string]> = [
    ["01", "Autonomous critical edition", "Upload PDF, EPUB, plain text, or Markdown. Page-aware extraction keeps body prose, footnotes, endnotes, bibliography, and captions apart; the original file stays immutable, and only a run that actually succeeded is published."],
    ["02", "Passage-centered reader", "Highlights, notes, and bookmarks anchor to a quotation and its surroundings rather than page coordinates, so they survive reflow and re-extraction. Footnotes, saved position, typography controls, focus mode, search, work tabs, split-pane."],
    ["03", "Resolved citations, never invented", "Deterministic passes read bibliographies, inline author–year forms, and footnote-only conventions, then match each citation against Crossref, OpenAlex, Open Library, Google Books, and Semantic Scholar. Title, author, year, and DOI come only from a real match; anything unmatched stays visibly unresolved."],
    ["04", "Credibility kept in dimensions", "Publication rigor, creator expertise, host provenance, evidence strength, relevance, and pedagogical value stay separate and separately labelled. Popularity is recorded and shown, and never counted as credibility."],
    ["05", "Unified Library", "Uploaded, cited, recommended, saved, and referenced-but-unacquired sources collapse into one canonical entry per work — while each keeps the reason it entered your reading world."],
    ["06", "Roadmap and curriculum routes", "References are ranked into dependency-ordered priority tiers and recomputed on every request, so a new rating or a re-run can never leave a stale plan behind. Five-stage routes run at minimal, university, and graduate depth."],
    ["07", "Ask Library", "Ask a question and get an answer assembled from passages actually retrieved out of your own library, each carrying the reader anchor it came from. A question with no supporting evidence gets an explicit not-found instead of an invented answer."],
    ["08", "Writing, cost, and safety controls", "Citation ingestion, MLA parenthetical citations and works-cited built from your own sources, DOCX and PDF export, per-run cost estimates with hard stops, versioned rollback, 30-day trash, and per-user isolation throughout."],
  ];
  return (
    <div className="scope-grid">
      {items.map(([number, title, copy]) => (
        <article key={number}>
          <span>{number}</span>
          <h3>{title}</h3>
          <p>{copy}</p>
        </article>
      ))}
    </div>
  );
}
