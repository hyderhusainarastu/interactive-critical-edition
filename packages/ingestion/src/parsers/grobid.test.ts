import { describe, expect, it } from "vitest";
import { parseTei } from "./grobid";

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
});
