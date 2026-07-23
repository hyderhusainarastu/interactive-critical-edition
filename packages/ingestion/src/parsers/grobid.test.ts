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
