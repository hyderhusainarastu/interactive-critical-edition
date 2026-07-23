import { describe, expect, it } from "vitest";
import { parseTei } from "./grobid";
import { type ParsedPage, processedTextFromPages } from "./pdf";

const TEI = `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader>
    <fileDesc>
      <titleStmt><title level="a" type="main">On the Nature of Things</title></titleStmt>
      <sourceDesc>
        <biblStruct>
          <analytic>
            <author><persName><forename type="first">Jane</forename><surname>Doe</surname></persName></author>
          </analytic>
        </biblStruct>
      </sourceDesc>
    </fileDesc>
  </teiHeader>
  <text xml:lang="en">
    <body>
      <div>
        <head coords="1,72.0,80.0,300.0,14.0">Introduction</head>
        <p coords="1,72.0,100.0,400.0,120.0">The main body discusses causation.<note place="foot" n="1" coords="1,72.0,700.0,400.0,10.0">See Aristotle, Physics II.</note> It continues afterward.</p>
      </div>
      <div>
        <head coords="2,72.0,80.0,300.0,14.0">Method</head>
        <p coords="2,72.0,100.0,400.0,120.0">A second page paragraph.</p>
        <figure coords="2,72.0,420.0,400.0,40.0"><figDesc>A diagram of the causal sequence.</figDesc></figure>
        <note place="end" n="2" coords="2,72.0,690.0,400.0,10.0">An endnote, distinct from the footnote.</note>
      </div>
    </body>
    <back>
      <div type="references">
        <listBibl>
          <biblStruct coords="3,72.0,80.0,400.0,20.0"><monogr><title level="m">Physics</title><author><persName><surname>Aristotle</surname></persName></author></monogr></biblStruct>
        </listBibl>
      </div>
    </back>
  </text>
</TEI>`;

describe("parseTei", () => {
  const result = parseTei(TEI);

  it("returns null for non-TEI input", () => {
    expect(parseTei("<html></html>")).toBeNull();
    expect(parseTei("not xml at all")).toBeNull();
  });

  it("extracts title and authors from the header", () => {
    expect(result).not.toBeNull();
    expect(result!.title).toBe("On the Nature of Things");
    expect(result!.authors).toContain("Jane Doe");
  });

  it("maps headings to their page via coordinates", () => {
    const intro = result!.blocks.find((b) => b.kind === "header" && b.text === "Introduction");
    const method = result!.blocks.find((b) => b.kind === "header" && b.text === "Method");
    expect(intro?.pageIndex).toBe(0);
    expect(method?.pageIndex).toBe(1);
    expect(intro?.bbox?.page).toBe(1);
  });

  it("does NOT duplicate footnote text into the body block", () => {
    const body = result!.blocks.find((b) => b.kind === "body" && b.text.includes("causation"));
    expect(body).toBeDefined();
    expect(body!.text).toContain("The main body discusses causation.");
    expect(body!.text).toContain("It continues afterward.");
    // The nested note must be emitted separately, never folded into the body.
    expect(body!.text).not.toContain("Aristotle");
  });

  it("emits the footnote as its own page-anchored block with a marker", () => {
    const notes = result!.blocks.filter((b) => b.kind === "footnote");
    expect(notes).toHaveLength(1);
    expect(notes[0].text).toBe("See Aristotle, Physics II.");
    expect(notes[0].marker).toBe("1");
    expect(notes[0].pageIndex).toBe(0);
  });

  it("keeps endnotes and captions in their own page-anchored structures", () => {
    const endnote = result!.blocks.find((block) => block.kind === "endnote");
    const caption = result!.blocks.find((block) => block.kind === "caption");
    expect(endnote).toMatchObject({ marker: "2", pageIndex: 1, text: "An endnote, distinct from the footnote." });
    expect(caption).toMatchObject({ pageIndex: 1, text: "A diagram of the causal sequence." });
    expect(result!.blocks.filter((block) => block.kind === "body").map((block) => block.text).join(" ")).not.toContain("An endnote");
  });

  it("maps the bibliography entry to a reference block on its page", () => {
    const refs = result!.blocks.filter((b) => b.kind === "reference");
    expect(refs).toHaveLength(1);
    expect(refs[0].text).toContain("Physics");
    expect(refs[0].text).toContain("Aristotle");
    expect(refs[0].pageIndex).toBe(2);
  });

  it("captures the document title as the leading title block", () => {
    expect(result!.blocks[0]).toMatchObject({ kind: "title", text: "On the Nature of Things" });
  });

  it("trusts the header title verbatim when a real author persName is present", () => {
    expect(result!.titleSource).toBe("header");
  });
});

// D-20-67 regression fixture. Entirely fictional text (not a paraphrase of
// any real article) reproducing the failure's real structural shape: a
// GROBID header pass that (1) reports a publisher/imprint-like string as the
// title and (2) finds no <persName> at all — only an institutional
// <affiliation> — while the body's own heading pass correctly segmented a
// venue line, the real (larger) title, and an author line on the earliest
// page carrying any heading.
const PUBLISHER_TITLE_TEI = `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader>
    <fileDesc>
      <titleStmt><title level="a" type="main">Fictional Learned Society Press</title></titleStmt>
      <sourceDesc>
        <biblStruct status="extracted">
          <analytic>
            <author><affiliation key="aff0"><orgName type="institution">Fictional University</orgName></affiliation></author>
            <title level="a" type="main">Fictional Learned Society Press</title>
          </analytic>
        </biblStruct>
      </sourceDesc>
    </fileDesc>
  </teiHeader>
  <text xml:lang="en">
    <body>
      <div>
        <head coords="1,60.0,90.0,200.0,6.0">Example Quarterly Review</head>
        <head coords="1,60.0,120.0,320.0,16.0">A STUDY OF INVENTED PHILOSOPHICAL EXAMPLES</head>
        <head coords="1,60.0,160.0,150.0,11.0">Alex Placeholder</head>
        <p coords="1,60.0,200.0,320.0,60.0">This invented paragraph stands in for the article body and discusses nothing real.</p>
      </div>
      <div>
        <head coords="4,60.0,90.0,250.0,10.0">Part Two: A Later Invented Section</head>
        <p coords="4,60.0,120.0,320.0,60.0">A second invented paragraph, further into the document.</p>
      </div>
    </body>
  </text>
</TEI>`;

// D-20-84 regression fixture. Reproduces (in a trimmed, individually short
// quote — sufficient only to prove the parsing shape, not the source's full
// text) the real GROBID TEI output for the baseline_test Roochnik "Vicious
// Man" fixture's back-of-document Notes section. GROBID's own citation-
// segmentation model correctly isolates a clean Brickhouse journal-article
// biblStruct (matching this fixture's real b11 entry: T. Brickhouse, "Does
// Aristotle Have a Consistent Account of Vice?", Review of Metaphysics, 57,
// 2003); several entries later in the same reference list — the Liddell &
// Scott lexicon entry (matching the real b14 entry; the real list actually
// has two intervening biblStructs, b12/b13, between them — see
// AUTHOR_AND_DATE_CONTAMINATION_TEI below, which reproduces that real gap
// for the adjacency-window test) — its <note> child, GROBID's own "residual/
// unclassified" field for an imperfectly segmented reference, is populated
// with an earlier entry's title text instead of anything belonging to this
// citation. The <note> exclusion itself has no adjacency dependency (a
// biblStruct's own <note> is always treated as unreliable, regardless of
// distance from anything else), so this trimmed two-entry version is still
// sufficient to prove that guard in isolation. Confirmed against the real
// service/fixture 2026-07-23; see D-20-84.
const NOTE_CONTAMINATION_TEI = `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader><fileDesc><titleStmt><title level="a" type="main">Fixture</title></titleStmt></fileDesc></teiHeader>
  <text xml:lang="en">
    <body><div><p coords="1,60.0,100.0,300.0,20.0">Body text.</p></div></body>
    <back>
      <div type="references">
        <listBibl>
          <biblStruct coords="14,88.57,478.26,303.96,10.20" status="extracted" xml:id="b11">
            <analytic>
              <title level="a" type="main">Does Aristotle Have a Consistent Account of Vice?</title>
              <author><persName coords=""><forename type="first">T</forename><surname>Brickhouse</surname></persName></author>
            </analytic>
            <monogr>
              <title level="j">Review of Metaphysics</title>
              <imprint><biblScope unit="volume">57</biblScope><date type="published" when="2003">2003</date></imprint>
            </monogr>
          </biblStruct>
          <biblStruct coords="14,65.40,560.58,299.29,10.32" status="extracted" xml:id="b14">
            <monogr>
              <title level="m" type="main">These translations are all found in the standard Greek-English Lexicon of</title>
              <author><persName coords=""><surname>Brickhouse</surname></persName></author>
              <imprint><publisher>Liddell and Scott</publisher><biblScope unit="volume">18</biblScope></imprint>
            </monogr>
            <note>Does Aristotle Have a Consistent Account of Vice?</note>
          </biblStruct>
        </listBibl>
      </div>
    </back>
  </text>
</TEI>`;

// D-20-84 second contamination channel. The <note> exclusion above was found
// (confirmed by running the real fixture through the real GROBID service,
// 2026-07-23) to be necessary but NOT sufficient: the Liddell & Scott entry's
// own <author> field, a structured field the <note> guard doesn't touch,
// ALSO carries a nearby Brickhouse entry's bare surname (no forename — unlike
// b11's real "T Brickhouse", which always carries one), plus its <date> can
// independently carry a second citation's year concatenated onto the real
// one (e.g. a real `when="1980"` sitting on text "1984. 1980"). This fixture
// reproduces both, trimmed to short quotes for parsing-shape proof.
//
// The gap between b11 and b14 is NOT immediately-adjacent (distance 1) — the
// real fixture's `<listBibl>` puts two more biblStructs (b12, b13) between
// them, distance 3, confirmed by running the real fixture through the real
// GROBID service 2026-07-23. Both intervening entries are themselves
// artifacts of the same over-segmented continuous-prose footnote run: b12 is
// a real, unrelated Irwin citation with a stray connective-prose <note>
// appended (also reproduced here, trimmed, to double as the "adjacent
// contamination-guard <note> exclusion applies to an unrelated entry too"
// case); b13 carries no author or imprint at all, only a <title> that is
// really leftover prose ("Brickhouse acknowledges that..."), reproduced here
// as an empty-imprint filler. This fixture is therefore the faithful,
// real-distance version of the persName-adjacency case — not a trivially
// adjacent 2-entry toy — and is what actually pins
// `CONTAMINATION_ADJACENCY_WINDOW` at 3, not 1.
const AUTHOR_AND_DATE_CONTAMINATION_TEI = `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader><fileDesc><titleStmt><title level="a" type="main">Fixture</title></titleStmt></fileDesc></teiHeader>
  <text xml:lang="en">
    <body><div><p coords="1,60.0,100.0,300.0,20.0">Body text.</p></div></body>
    <back>
      <div type="references">
        <listBibl>
          <biblStruct coords="14,88.57,478.26,303.96,10.20" status="extracted" xml:id="b11">
            <analytic>
              <title level="a" type="main">Does Aristotle Have a Consistent Account of Vice?</title>
              <author><persName coords=""><forename type="first">T</forename><surname>Brickhouse</surname></persName></author>
            </analytic>
            <monogr>
              <title level="j">Review of Metaphysics</title>
              <imprint><biblScope unit="volume">57</biblScope><date type="published" when="2003">2003</date></imprint>
            </monogr>
          </biblStruct>
          <biblStruct coords="14,88.69,522.30,306.95,10.20" status="extracted" xml:id="b12">
            <monogr>
              <author><persName coords=""><forename type="first">T</forename><surname>Irwin</surname></persName></author>
              <title level="m">Aristotle's Nicomachean Ethics</title>
              <imprint><publisher>Indianapolis: Hackett</publisher><date type="published" when="1999">1999</date></imprint>
            </monogr>
            <note>argues along these lines</note>
          </biblStruct>
          <biblStruct coords="14,88.69,549.54,306.25,10.32" status="extracted" xml:id="b13">
            <monogr>
              <title level="m" type="main">Brickhouse acknowledges that Aristotle does not make this explicit</title>
              <imprint/>
            </monogr>
          </biblStruct>
          <biblStruct coords="14,65.40,560.58,299.29,10.32" status="extracted" xml:id="b14">
            <monogr>
              <title level="m" type="main">These translations are all found in the standard Greek-English Lexicon of</title>
              <author><persName coords=""><surname>Brickhouse</surname></persName></author>
              <imprint><publisher>Liddell and Scott</publisher><biblScope unit="volume">18</biblScope></imprint>
            </monogr>
            <note>Does Aristotle Have a Consistent Account of Vice?</note>
          </biblStruct>
          <biblStruct coords="14,62.88,181.98,325.15,10.20" status="extracted" xml:id="b3">
            <analytic>
              <title level="a" type="main">Practical Reason, Aristotle, and Weakness of the Will</title>
              <author><persName coords=""><forename type="first">N</forename><surname>Dahl</surname></persName></author>
              <author><persName coords=""><forename type="first">D</forename><surname>Davidson</surname></persName></author>
            </analytic>
            <monogr>
              <title level="m">Essays on Actions and Events</title>
              <imprint>
                <publisher>Oxford University Press</publisher>
                <date type="published" when="1980">1984. 1980</date>
              </imprint>
            </monogr>
          </biblStruct>
        </listBibl>
      </div>
    </back>
  </text>
</TEI>`;

// D-20-84 verifier-caught adversarial scenario: two DISTINCT people who
// happen to share a surname, far apart (well outside
// `CONTAMINATION_ADJACENCY_WINDOW`) in the reference list, with unrelated
// filler entries between them. A document-wide guard (the first version of
// this fix) incorrectly stripped the second person's own bare surname just
// because SOME forenamed "Smith" existed anywhere else in the list — proven
// directly against that document-wide code, before the adjacency fix, using
// this exact fixture: the distant entry's own author field was removed
// entirely even though the two Smiths are unconnected. The adjacency-scoped
// guard must leave both untouched.
const NON_ADJACENT_SAME_SURNAME_TEI = `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader><fileDesc><titleStmt><title level="a" type="main">Fixture</title></titleStmt></fileDesc></teiHeader>
  <text xml:lang="en">
    <body><div><p coords="1,60.0,100.0,300.0,20.0">Body text.</p></div></body>
    <back>
      <div type="references">
        <listBibl>
          <biblStruct xml:id="s0"><analytic><title level="a" type="main">Real Smith Paper One</title><author><persName><forename type="first">Adam</forename><surname>Smith</surname></persName></author></analytic></biblStruct>
          <biblStruct xml:id="f1"><analytic><title level="a" type="main">Filler One</title></analytic></biblStruct>
          <biblStruct xml:id="f2"><analytic><title level="a" type="main">Filler Two</title></analytic></biblStruct>
          <biblStruct xml:id="f3"><analytic><title level="a" type="main">Filler Three</title></analytic></biblStruct>
          <biblStruct xml:id="f4"><analytic><title level="a" type="main">Filler Four</title></analytic></biblStruct>
          <biblStruct xml:id="f5"><analytic><title level="a" type="main">Filler Five</title></analytic></biblStruct>
          <biblStruct xml:id="s10"><analytic><title level="a" type="main">A Second, Unrelated Smith Study</title><author><persName><surname>Smith</surname></persName></author></analytic></biblStruct>
        </listBibl>
      </div>
    </back>
  </text>
</TEI>`;

// D-20-84 minimal adjacent-contamination case (distance 1): the simplest
// shape the guard must still catch — an immediately-following biblStruct
// whose only mention of a forenamed-elsewhere surname is bare.
const ADJACENT_SAME_SURNAME_TEI = `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader><fileDesc><titleStmt><title level="a" type="main">Fixture</title></titleStmt></fileDesc></teiHeader>
  <text xml:lang="en">
    <body><div><p coords="1,60.0,100.0,300.0,20.0">Body text.</p></div></body>
    <back>
      <div type="references">
        <listBibl>
          <biblStruct xml:id="s0"><analytic><title level="a" type="main">Real Jones Paper</title><author><persName><forename type="first">Ellen</forename><surname>Jones</surname></persName></author></analytic></biblStruct>
          <biblStruct xml:id="s1"><analytic><title level="a" type="main">An Adjacent Echo Entry</title><author><persName><surname>Jones</surname></persName></author></analytic></biblStruct>
        </listBibl>
      </div>
    </back>
  </text>
</TEI>`;

// D-20-84 second real date-concatenation instance, found while reconciling
// the fix's regression claim against the FULL real fixture (not just the
// one Dahl/Davidson entry originally tested): the real fixture's b0 entry
// (Press & Pritzl, "Endoxa as Appearances", Ancient Philosophy 14) carries
// `when="1986"` on a `<date>` whose own raw text reads "1986. 1994" — the
// same concatenation shape as the already-tested b3/Dahl-Davidson case, on a
// completely unrelated citation with no persName contamination at all.
// Confirmed against the real service/fixture 2026-07-23.
const SECOND_DATE_CONCATENATION_TEI = `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader><fileDesc><titleStmt><title level="a" type="main">Fixture</title></titleStmt></fileDesc></teiHeader>
  <text xml:lang="en">
    <body><div><p coords="1,60.0,100.0,300.0,20.0">Body text.</p></div></body>
    <back>
      <div type="references">
        <listBibl>
          <biblStruct coords="14,111.48,107.26,97.10,6.45" status="extracted" xml:id="b0">
            <analytic>
              <title level="a" type="main">Endoxa as Appearances</title>
              <author><persName coords=""><forename type="middle">K</forename><surname>Press</surname></persName></author>
              <author><persName coords=""><surname>Pritzl</surname></persName></author>
            </analytic>
            <monogr>
              <title level="j">Ancient Philosophy</title>
              <imprint>
                <biblScope unit="volume">14</biblScope>
                <date type="published" when="1986">1986. 1994</date>
              </imprint>
            </monogr>
          </biblStruct>
        </listBibl>
      </div>
    </back>
  </text>
</TEI>`;

describe("parseTei — D-20-84 biblStruct <note> cross-citation contamination guard", () => {
  it("does not import an adjacent citation's title into this entry's reference text via the <note> field", () => {
    const result = parseTei(NOTE_CONTAMINATION_TEI);
    expect(result).not.toBeNull();
    const refs = result!.blocks.filter((b) => b.kind === "reference");
    expect(refs).toHaveLength(2);
    const liddellScott = refs.find((r) => r.text.includes("Liddell and Scott"));
    expect(liddellScott).toBeDefined();
    // The Brickhouse essay title belongs to the OTHER entry (b11) — it must
    // never appear inside the Liddell & Scott entry's own reference text.
    expect(liddellScott!.text).not.toContain("Does Aristotle Have a Consistent Account of Vice?");
  });

  it("leaves a clean, note-free biblStruct's reference text unaffected", () => {
    const result = parseTei(NOTE_CONTAMINATION_TEI);
    const refs = result!.blocks.filter((b) => b.kind === "reference");
    const brickhouse = refs.find((r) => r.text.includes("Review of Metaphysics"));
    expect(brickhouse).toBeDefined();
    expect(brickhouse!.text).toContain("Does Aristotle Have a Consistent Account of Vice?");
    expect(brickhouse!.text).toContain("Brickhouse");
    expect(brickhouse!.text).toContain("2003");
  });

  it("does not import an adjacent citation's bare-surname author into this entry's reference text", () => {
    const result = parseTei(AUTHOR_AND_DATE_CONTAMINATION_TEI);
    expect(result).not.toBeNull();
    const refs = result!.blocks.filter((b) => b.kind === "reference");
    const liddellScott = refs.find((r) => r.text.includes("Liddell and Scott"));
    expect(liddellScott).toBeDefined();
    // "Brickhouse" belongs to the OTHER (fully-attributed, forenamed) entry —
    // this entry's own author field only ever carried a bare, forename-less
    // echo of it, which must not surface in the Liddell & Scott query text.
    expect(liddellScott!.text).not.toContain("Brickhouse");
    expect(liddellScott!.text).toContain("Liddell and Scott");
  });

  it("keeps a bare surname that is this entry's OWN only mention of that person (no other biblStruct owns a forenamed version)", () => {
    // b11 itself is the sole, forenamed owner of "Brickhouse" — its own text
    // must still contain its own author untouched (already covered above),
    // and a hypothetical unrelated bare surname with no forenamed owner
    // anywhere in the document must never be stripped just for lacking a
    // forename — only a same-surname COLLISION with a different, forenamed
    // biblStruct is treated as contamination.
    const result = parseTei(AUTHOR_AND_DATE_CONTAMINATION_TEI);
    const refs = result!.blocks.filter((b) => b.kind === "reference");
    const brickhouse = refs.find((r) => r.text.includes("Review of Metaphysics"));
    expect(brickhouse!.text).toContain("Brickhouse");
  });

  it("prefers a <date>'s @when attribute over raw text that concatenates two citations' years", () => {
    const result = parseTei(AUTHOR_AND_DATE_CONTAMINATION_TEI);
    const refs = result!.blocks.filter((b) => b.kind === "reference");
    const dahl = refs.find((r) => r.text.includes("Practical Reason"));
    expect(dahl).toBeDefined();
    expect(dahl!.text).toContain("1980");
    // The raw, un-normalized concatenation must never reach the reference
    // text the resolution query is built from.
    expect(dahl!.text).not.toContain("1984. 1980");
  });

  it("still strips the bare surname across the real 3-position gap (b11 -> b12 -> b13 -> b14), not just a trivially adjacent pair", () => {
    // AUTHOR_AND_DATE_CONTAMINATION_TEI now reproduces the real fixture's
    // actual gap (two intervening biblStructs), not a toy 2-entry list. This
    // is the test that actually pins CONTAMINATION_ADJACENCY_WINDOW at 3.
    const result = parseTei(AUTHOR_AND_DATE_CONTAMINATION_TEI);
    const refs = result!.blocks.filter((b) => b.kind === "reference");
    expect(refs).toHaveLength(5);
    const liddellScott = refs.find((r) => r.text.includes("Liddell and Scott"));
    expect(liddellScott).toBeDefined();
    expect(liddellScott!.text).not.toContain("Brickhouse");
  });

  it("leaves the intervening filler entries' own real content untouched (b12's own Irwin author survives)", () => {
    // The two entries between the owner and the contaminated one are not
    // touched by the contamination guard themselves — b12 is a real,
    // unrelated citation and its own forenamed author must remain.
    const result = parseTei(AUTHOR_AND_DATE_CONTAMINATION_TEI);
    const refs = result!.blocks.filter((b) => b.kind === "reference");
    const irwin = refs.find((r) => r.text.includes("Nicomachean Ethics"));
    expect(irwin).toBeDefined();
    expect(irwin!.text).toContain("Irwin");
  });

  it("excludes a biblStruct's own connective-prose <note> even when it carries no cross-citation contamination (intended, not collateral)", () => {
    // Reconciling the fix's regression claim against the real fixture found
    // 3 MORE biblStructs (beyond the flagship Liddell & Scott case) that lose
    // <note> text: all 3 are pure connective/pointer prose with zero
    // independent bibliographic signal, matching the design's own stated
    // rationale for excluding <note> unconditionally. b12's note here
    // ("argues along these lines") reproduces one of them verbatim from the
    // real fixture — this is the intended, documented behavior of the
    // existing <note> exclusion, not a new defect to fix.
    const result = parseTei(AUTHOR_AND_DATE_CONTAMINATION_TEI);
    const refs = result!.blocks.filter((b) => b.kind === "reference");
    const irwin = refs.find((r) => r.text.includes("Nicomachean Ethics"));
    expect(irwin!.text).not.toContain("argues along these lines");
  });

  it("D-20-84 verifier-caught adversarial case: leaves two distinct same-surname people untouched when they are NOT within the adjacency window", () => {
    const result = parseTei(NON_ADJACENT_SAME_SURNAME_TEI);
    expect(result).not.toBeNull();
    const refs = result!.blocks.filter((b) => b.kind === "reference");
    const first = refs.find((r) => r.text.includes("Real Smith Paper One"));
    const second = refs.find((r) => r.text.includes("Second, Unrelated Smith Study"));
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    // Both are genuinely distinct people — a document-wide guard (proven
    // against this exact fixture, pre-adjacency-fix) incorrectly stripped
    // the second entry's own bare "Smith" here; the adjacency-scoped guard
    // must keep it, since "Smith" also appears in this entry's own title.
    expect(first!.text).toContain("Smith");
    const secondSmithMentions = second!.text.split("Smith").length - 1;
    expect(secondSmithMentions).toBe(2); // title's "Smith" + its own author's "Smith"
  });

  it("still strips a minimal, literally-adjacent (distance 1) bare-surname contamination", () => {
    const result = parseTei(ADJACENT_SAME_SURNAME_TEI);
    expect(result).not.toBeNull();
    const refs = result!.blocks.filter((b) => b.kind === "reference");
    const owner = refs.find((r) => r.text.includes("Real Jones Paper"));
    const echo = refs.find((r) => r.text.includes("An Adjacent Echo Entry"));
    expect(owner).toBeDefined();
    expect(echo).toBeDefined();
    expect(owner!.text).toContain("Jones");
    // The echo entry's own title contains no "Jones" — its persName was its
    // only mention, so the count must drop to zero once stripped.
    expect(echo!.text).not.toContain("Jones");
  });

  it("D-20-84 second date-concatenation instance (b0 Press/Pritzl): prefers @when over raw concatenated text here too", () => {
    // Found while reconciling the regression claim against the full real
    // fixture — a second, independent occurrence of the same date-@when
    // fix, on a citation with no persName contamination at all.
    const result = parseTei(SECOND_DATE_CONCATENATION_TEI);
    expect(result).not.toBeNull();
    const refs = result!.blocks.filter((b) => b.kind === "reference");
    const pressPritzl = refs.find((r) => r.text.includes("Endoxa as Appearances"));
    expect(pressPritzl).toBeDefined();
    expect(pressPritzl!.text).toContain("1986");
    expect(pressPritzl!.text).not.toContain("1986. 1994");
  });
});

describe("parseTei — D-20-67 header-title guard", () => {
  it("rejects a header title when the header found zero person names, recovering the largest heading on the earliest heading page instead", () => {
    const result = parseTei(PUBLISHER_TITLE_TEI);
    expect(result).not.toBeNull();
    expect(result!.title).toBe("A STUDY OF INVENTED PHILOSOPHICAL EXAMPLES");
    expect(result!.title).not.toBe("Fictional Learned Society Press");
    expect(result!.titleSource).toBe("body-heading");
    // No persName anywhere in this fixture's header — author recovery is
    // deliberately NOT attempted (see grobid.ts); null is the honest result.
    expect(result!.authors).toEqual([]);
  });

  it("does NOT unshift a synthetic title block for a recovered title — the heading stays at its natural position", () => {
    // Regression: unshifting a leading "title" block here would duplicate the
    // heading that `walkBody` already emitted at index 1 (the venue line at
    // index 0 comes first in real reading order), rendering the recovered
    // title twice once `processedTextFromPages` joins the blocks.
    const result = parseTei(PUBLISHER_TITLE_TEI);
    expect(result!.blocks[0]).toMatchObject({ kind: "header", text: "Example Quarterly Review" });
    expect(result!.blocks[1]).toMatchObject({ kind: "header", text: "A STUDY OF INVENTED PHILOSOPHICAL EXAMPLES" });
  });

  it("carries the recovered title in exactly one block", () => {
    const result = parseTei(PUBLISHER_TITLE_TEI);
    const matches = result!.blocks.filter((b) => b.text === "A STUDY OF INVENTED PHILOSOPHICAL EXAMPLES");
    expect(matches).toHaveLength(1);
    expect(matches[0].kind).toBe("header");
  });

  it("renders the recovered title exactly once in the processed reader text (D-20-67 duplicate-title regression)", () => {
    // Reproduces what parsePdf/processedTextFromPages actually do with these
    // blocks: group by pageIndex into pages, then join every title/header/
    // body/caption block. Before this fix, the unshifted synthetic "title"
    // block plus the untouched source heading rendered the title twice.
    const result = parseTei(PUBLISHER_TITLE_TEI);
    const maxPage = Math.max(0, ...result!.blocks.map((b) => b.pageIndex ?? 0));
    const pages: ParsedPage[] = Array.from({ length: maxPage + 1 }, (_, pageIndex) => ({
      pageIndex,
      text: "",
      isOcr: false,
      extractionConfidence: null,
      blocks: [],
    }));
    for (const block of result!.blocks) {
      pages[block.pageIndex ?? 0].blocks.push({ kind: block.kind, text: block.text, marker: block.marker, bbox: block.bbox });
    }
    const text = processedTextFromPages(pages);
    const occurrences = text.split("A STUDY OF INVENTED PHILOSOPHICAL EXAMPLES").length - 1;
    expect(occurrences).toBe(1);
  });

  it("falls back to a null title (not the untrusted header title) when the body has no headings to recover from", () => {
    const noHeadings = PUBLISHER_TITLE_TEI.replace(/<head[^>]*>.*?<\/head>/gs, "");
    const result = parseTei(noHeadings);
    expect(result).not.toBeNull();
    expect(result!.title).toBeNull();
    expect(result!.titleSource).toBeNull();
  });
});
