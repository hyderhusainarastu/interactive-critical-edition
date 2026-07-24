import { describe, expect, it } from "vitest";
import { normalizeBoilerplateCandidate } from "./boilerplate";
import { recoverLeadingBodyProse } from "./bodyRecovery";

const base = {
  title: "Does Example Have a Consistent Account",
  author: "Sample Author",
  boilerplateKeys: new Set<string>(),
  normalizeBoilerplate: normalizeBoilerplateCandidate,
};

const OPENING =
  "How ARE WE TO UNDERSTAND the example claim in this article? As many commentators have noted, it is by no means obvious that the scattered remarks about the topic really add up to a coherent account of the matter at hand.";

describe("recoverLeadingBodyProse", () => {
  it("recovers a leading paragraph GROBID skipped on a genuine body page", () => {
    const pageText = [
      "Does Example Have a Consistent Account",
      "SAMPLE AUTHOR",
      OPENING,
      "1 First footnote text that must not be recovered as body.",
    ].join("\n");
    const recovered = recoverLeadingBodyProse({
      ...base,
      pageText,
      pageBodyBlockTexts: ["A later paragraph GROBID did capture on this page."],
      allBodyBlockTexts: ["A later paragraph GROBID did capture on this page."],
    });
    expect(recovered).toBe(OPENING);
  });

  it("returns null on a page GROBID found no body on at all (cover / front-matter)", () => {
    const pageText = [
      "Does Example Have a Consistent Account",
      "Author(s): Sample Author",
      "Source: The Example Review, 2003, Vol. 57, No. 1, pp. 3-23",
      "JSTOR is a not-for-profit service that helps scholars and researchers discover content.",
    ].join("\n");
    expect(
      recoverLeadingBodyProse({ ...base, pageText, pageBodyBlockTexts: [], allBodyBlockTexts: ["unrelated body"] }),
    ).toBeNull();
  });

  it("returns null when the leading prose is already represented by GROBID", () => {
    const pageText = [OPENING, "1 A footnote."].join("\n");
    expect(
      recoverLeadingBodyProse({
        ...base,
        pageText,
        pageBodyBlockTexts: [OPENING],
        allBodyBlockTexts: [OPENING],
      }),
    ).toBeNull();
  });

  it("truncates at prose GROBID captured elsewhere (document-wide dedup), never duplicating", () => {
    const missingTop = "The missing top of the page continues the argument for several clauses here, developing the earlier point at length and setting up the contrast that immediately follows it in the text.";
    const grobidCaptured = "Elsewhere, however, the author takes a different view of the same question.";
    const pageText = ["SAMPLE AUTHOR", missingTop, grobidCaptured, "1 A footnote."].join("\n");
    const recovered = recoverLeadingBodyProse({
      ...base,
      pageText,
      pageBodyBlockTexts: ["a page body block"],
      // GROBID captured `grobidCaptured` but attributed it to another page.
      allBodyBlockTexts: [`${grobidCaptured} and it goes on from there.`],
    });
    expect(recovered).toBe(missingTop);
    expect(recovered).not.toContain("Elsewhere");
  });

  it("stops collection at a numbered-footnote or correspondence boundary", () => {
    const pageText = [
      OPENING,
      "Correspondence to: Department of Example, Sample University.",
      "1 A footnote that follows.",
    ].join("\n");
    const recovered = recoverLeadingBodyProse({
      ...base,
      pageText,
      pageBodyBlockTexts: ["captured body"],
      allBodyBlockTexts: ["captured body"],
    });
    expect(recovered).toBe(OPENING);
    expect(recovered).not.toContain("Correspondence");
  });

  it("returns null when the surviving prose is too short to trust", () => {
    const pageText = ["SAMPLE AUTHOR", "Short.", "1 footnote"].join("\n");
    expect(
      recoverLeadingBodyProse({ ...base, pageText, pageBodyBlockTexts: ["body"], allBodyBlockTexts: ["body"] }),
    ).toBeNull();
  });

  it("does not recover a top that is mostly non-letter garble", () => {
    const garble = "?ia(j)?QOvxai ejiiQv\\iovgiv ?ley?Am o^o??ai axaoi?^ei ?i? ?aox??lQLav x? \\i?v ?eDqo";
    const pageText = ["SAMPLE AUTHOR", garble, "1 footnote"].join("\n");
    expect(
      recoverLeadingBodyProse({ ...base, pageText, pageBodyBlockTexts: ["body"], allBodyBlockTexts: ["body"] }),
    ).toBeNull();
  });
});
