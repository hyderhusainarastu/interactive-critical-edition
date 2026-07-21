import Link from "next/link";
import { SiteFooter } from "@/components/site/SiteFooter";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SITE_NAME } from "@/lib/brand";

export default function Home() {
  return (
    <div className="flex min-h-full flex-col">
      <SiteHeader />
      <main className="flex-1">
        <Hero />
        <ReaderShowcase />
        <RoadmapShowcase />
        <GraphShowcase />
        <HowItWorks />
        <Audiences />
        <Reliability />
        <FinalCta />
      </main>
      <SiteFooter />
    </div>
  );
}

function Hero() {
  return (
    <section className="mx-auto max-w-5xl px-6 pb-16 pt-16 sm:pt-24">
      <p className="mb-4 font-mono text-xs uppercase tracking-[0.14em] text-[var(--color-text-muted)]">
        For readers of difficult scholarly texts
      </p>
      <h1 className="max-w-3xl font-serif text-4xl font-semibold leading-[1.08] tracking-tight text-[var(--color-text)] text-balance sm:text-5xl md:text-6xl">
        Read hard books with the whole conversation around them in view.
      </h1>
      <p className="mt-6 max-w-2xl text-lg leading-relaxed text-[var(--color-text-muted)]">
        Upload a work of philosophy, a monograph, or a research article. {SITE_NAME} turns it into an annotated
        edition — the original text, its citations traced to real sources, the intellectual context it assumes,
        and a personalized, dependency-ordered plan for what to read to actually understand it.
      </p>
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <Link
          href="/signup"
          className="rounded-md bg-[var(--color-accent-ink)] px-5 py-2.5 text-sm font-medium text-[var(--color-background)]"
        >
          Start reading
        </Link>
        <Link
          href="#how"
          className="rounded-md border border-[var(--color-border)] px-5 py-2.5 text-sm font-medium text-[var(--color-text)]"
        >
          How it works
        </Link>
      </div>
      <p className="mt-4 text-sm text-[var(--color-text-muted)]">
        Every AI-generated claim carries a confidence and a source. It&rsquo;s a research aid — never a
        substitute for the primary text.
      </p>
    </section>
  );
}

/** Section scaffold: a title/lead column beside a restrained illustration. */
function Showcase({
  eyebrow,
  title,
  lead,
  children,
  flip = false,
}: {
  eyebrow: string;
  title: string;
  lead: string;
  children: React.ReactNode;
  flip?: boolean;
}) {
  return (
    <section className="border-t border-[var(--color-border)]">
      <div className="mx-auto grid max-w-5xl gap-8 px-6 py-16 md:grid-cols-2 md:items-center md:gap-12">
        <div className={flip ? "md:order-2" : undefined}>
          <p className="mb-3 font-mono text-xs uppercase tracking-[0.12em] text-[var(--color-accent-umber)]">
            {eyebrow}
          </p>
          <h2 className="font-serif text-2xl font-semibold text-[var(--color-text)] text-balance sm:text-3xl">
            {title}
          </h2>
          <p className="mt-3 text-[var(--color-text-muted)]">{lead}</p>
        </div>
        <div className={flip ? "md:order-1" : undefined}>{children}</div>
      </div>
    </section>
  );
}

function ReaderShowcase() {
  return (
    <Showcase
      eyebrow="The reader"
      title="Annotations that show their work"
      lead="Hover any marker and see what a passage references, why, and how sure the system is — with the exact source text that triggered it. Approve, edit, or dismiss anything. Original footnotes, AI annotations, and your own notes stay visually distinct."
    >
      <figure className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
        <p className="font-serif text-[1.05rem] leading-[1.7] text-[var(--color-text)]">
          The question of the meaning of Being must be raised anew. Here the inquiry builds directly on
          Kant&rsquo;s transcendental method
          <span
            className="reader-annotation-marker"
            style={{ "--reader-annotation-color": "var(--color-accent-green)" } as React.CSSProperties}
            aria-hidden
          >
            ❋
          </span>
          , which first cleared the ground for the question.
        </p>
        <div className="mt-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3">
          <div className="flex items-center gap-2 text-xs">
            <span
              aria-hidden
              className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[0.7rem] font-bold text-[var(--color-background)]"
              style={{ background: "var(--color-accent-green)" }}
            >
              ❋
            </span>
            <span className="font-semibold text-[var(--color-accent-green)]">Conceptual influence</span>
            <span className="ml-auto text-[var(--color-text-muted)]">High · 82%</span>
          </div>
          <p className="mt-2 text-sm font-medium text-[var(--color-text)]">
            Critique of Pure Reason — Immanuel Kant
          </p>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            Shaped the ideas of the primary text. Resolved to a bibliographic record via Crossref.
          </p>
        </div>
      </figure>
    </Showcase>
  );
}

function RoadmapShowcase() {
  const items: { tier: string; color: string; title: string; why: string }[] = [
    { tier: "Essential", color: "--color-accent-burgundy", title: "Critique of Pure Reason", why: "A prerequisite — read first." },
    { tier: "High priority", color: "--color-accent-ink", title: "Logical Investigations", why: "Shaped the text’s method." },
    { tier: "Comparative", color: "--color-accent-umber", title: "The Myth of Sisyphus", why: "A parallel, not a prerequisite." },
  ];
  return (
    <Showcase
      flip
      eyebrow="The roadmap"
      title="A reading order, not a pile of citations"
      lead="Every reference is ranked into priority tiers and ordered by what depends on what. Rate what you already know and the plan re-sorts to skip it. Filter by time budget, depth, or expertise."
    >
      <div className="flex flex-col gap-2">
        {items.map((it, i) => (
          <div
            key={it.title}
            className="flex items-start gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
          >
            <span className="mt-0.5 font-mono text-sm text-[var(--color-text-muted)]">{i + 1}</span>
            <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: `var(${it.color})` }} />
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: `var(${it.color})` }}>
                {it.tier}
              </p>
              <p className="font-medium text-[var(--color-text)]">{it.title}</p>
              <p className="text-xs text-[var(--color-text-muted)]">{it.why}</p>
            </div>
          </div>
        ))}
      </div>
    </Showcase>
  );
}

function GraphShowcase() {
  return (
    <Showcase
      eyebrow="The knowledge graph"
      title="See what you&rsquo;ve read — and what you&rsquo;re missing"
      lead="Your library as a map: works, the readings they reference, and the gaps. Referenced-but-unacquired sources show as missing links, so you can see the shape of a field before you&rsquo;re deep in it. A full 3D view lives behind login, with an accessible table for every node."
    >
      <figure className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
        <GraphSketch />
        <figcaption className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--color-text-muted)]">
          <Legend color="--color-accent-ink" label="Your work" />
          <Legend color="--color-accent-green" label="Read" />
          <Legend color="--color-accent-umber" label="Unread" />
          <Legend color="--color-accent-burgundy" label="Missing" />
        </figcaption>
      </figure>
    </Showcase>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: `var(${color})` }} />
      {label}
    </span>
  );
}

/** A small, static 2D graph sketch — deliberately not the WebGL 3D view
 *  (plan §19 keeps heavy 3D off the landing page). */
function GraphSketch() {
  const edges = [
    [130, 90, 45, 40],
    [130, 90, 60, 150],
    [130, 90, 225, 45],
    [130, 90, 235, 130],
    [130, 90, 150, 175],
  ];
  const nodes: { x: number; y: number; r: number; c: string }[] = [
    { x: 130, y: 90, r: 13, c: "--color-accent-ink" },
    { x: 45, y: 40, r: 8, c: "--color-accent-green" },
    { x: 60, y: 150, r: 8, c: "--color-accent-umber" },
    { x: 225, y: 45, r: 8, c: "--color-accent-burgundy" },
    { x: 235, y: 130, r: 8, c: "--color-accent-green" },
    { x: 150, y: 175, r: 8, c: "--color-accent-umber" },
  ];
  return (
    <svg
      viewBox="0 0 280 200"
      className="h-auto w-full"
      role="img"
      aria-label="A knowledge graph: one central work connected to five referenced readings, colored by whether they are read, unread, or missing."
    >
      {edges.map((e, i) => (
        <line key={i} x1={e[0]} y1={e[1]} x2={e[2]} y2={e[3]} stroke="var(--color-border)" strokeWidth={1.5} />
      ))}
      {nodes.map((n, i) => (
        <circle key={i} cx={n.x} cy={n.y} r={n.r} fill={`var(${n.c})`} />
      ))}
    </svg>
  );
}

function HowItWorks() {
  const steps = [
    { n: "1", t: "Upload", d: "PDF, EPUB, or plain text. It’s parsed, footnotes detected, metadata confirmed by you." },
    { n: "2", t: "Analyze", d: "Citations are extracted and resolved against real bibliographic sources; each reference is classified by how it relates to the text." },
    { n: "3", t: "Read", d: "Open the annotated edition. Highlight, note, bookmark — everything anchored to survive re-rendering." },
    { n: "4", t: "Plan & map", d: "Get a personalized reading roadmap and a knowledge graph of the field, both shaped by what you already know." },
  ];
  return (
    <section id="how" className="border-t border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="mx-auto max-w-5xl px-6 py-16">
        <h2 className="font-serif text-2xl font-semibold text-[var(--color-text)] sm:text-3xl">How it works</h2>
        <ol className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((s) => (
            <li key={s.n}>
              <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-full border border-[var(--color-border)] font-mono text-sm text-[var(--color-accent-umber)]">
                {s.n}
              </div>
              <h3 className="font-serif text-lg font-semibold text-[var(--color-text)]">{s.t}</h3>
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">{s.d}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Audiences() {
  return (
    <section className="border-t border-[var(--color-border)]">
      <div className="mx-auto grid max-w-5xl gap-6 px-6 py-16 md:grid-cols-2">
        <div className="rounded-xl border border-[var(--color-border)] p-6">
          <h3 className="font-serif text-xl font-semibold text-[var(--color-text)]">New to a field</h3>
          <p className="mt-2 text-[var(--color-text-muted)]">
            Start with the essentials. The roadmap surfaces the few prerequisites that actually unlock a difficult
            text, in the order they build on each other — so you don&rsquo;t drown in a bibliography.
          </p>
        </div>
        <div className="rounded-xl border border-[var(--color-border)] p-6">
          <h3 className="font-serif text-xl font-semibold text-[var(--color-text)]">Working researcher</h3>
          <p className="mt-2 text-[var(--color-text-muted)]">
            See the full contextual and comparative tail, trace every citation to its source, flag disagreements and
            interpretive aids, and map how a work sits in its intellectual tradition.
          </p>
        </div>
      </div>
    </section>
  );
}

function Reliability() {
  const points = [
    { t: "Provenance on every claim", d: "AI annotations carry the model used, the prompt version, and the verbatim passage that triggered them." },
    { t: "No invented sources", d: "Bibliographic facts come only from real lookups (Crossref, OpenAlex, Open Library) — never generated. Unmatched citations stay flagged, not guessed." },
    { t: "Confidence, always shown", d: "Nothing is presented as settled scholarship. You verify against the primary text, and can correct or hide anything." },
    { t: "Your data is yours", d: "Per-user isolation throughout. Uploads are yours to delete; content is never used to train models without explicit opt-in." },
  ];
  return (
    <section className="border-t border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="mx-auto max-w-5xl px-6 py-16">
        <h2 className="font-serif text-2xl font-semibold text-[var(--color-text)] sm:text-3xl">
          Built to be trusted, not believed
        </h2>
        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          {points.map((p) => (
            <div key={p.t}>
              <h3 className="font-medium text-[var(--color-text)]">{p.t}</h3>
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">{p.d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="border-t border-[var(--color-border)]">
      <div className="mx-auto max-w-5xl px-6 py-20 text-center">
        <h2 className="mx-auto max-w-2xl font-serif text-3xl font-semibold text-[var(--color-text)] text-balance">
          Bring the hardest thing on your shelf.
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-[var(--color-text-muted)]">
          Create an account and turn your first difficult text into an annotated critical edition.
        </p>
        <div className="mt-8">
          <Link
            href="/signup"
            className="rounded-md bg-[var(--color-accent-ink)] px-6 py-3 text-sm font-medium text-[var(--color-background)]"
          >
            Start reading
          </Link>
        </div>
      </div>
    </section>
  );
}
