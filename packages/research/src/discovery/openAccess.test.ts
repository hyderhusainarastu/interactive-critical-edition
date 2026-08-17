import { describe, expect, it } from "vitest";
import { findOpenAccessEvidence, retrieveOpenAccessText } from "./openAccess";

describe("open-access evidence", () => {
  it("requires an explicit approved license rather than trusting an OA flag", () => {
    expect(findOpenAccessEvidence({ open_access: { is_oa: true } }, "https://example.test/article")).toBeNull();
    expect(findOpenAccessEvidence({
      open_access: { is_oa: true },
      best_oa_location: { landing_page_url: "https://example.test/article", license: "cc-by" },
    }, null)).toMatchObject({ license: "cc-by", sourceUrl: "https://example.test/article" });
  });

  it("indexes bounded HTML and records a stable content hash", async () => {
    const evidence = findOpenAccessEvidence({ best_oa_location: { landing_page_url: "https://example.test/article", license: "CC BY 4.0" } }, null)!;
    const result = await retrieveOpenAccessText(evidence, async () => new Response(`<article><h1>Open study</h1><p>${"evidence ".repeat(20)}</p></article>`, { headers: { "content-type": "text/html" } }));
    expect(result).toMatchObject({ status: "open_access_indexed" });
    if (result.status === "open_access_indexed") expect(result.contentHash).toHaveLength(64);
  });

  it("leaves binary endpoints visibly available instead of scraping them", async () => {
    const evidence = findOpenAccessEvidence({ best_oa_location: { pdf_url: "https://example.test/article.pdf", license: "CC0" } }, null)!;
    await expect(retrieveOpenAccessText(evidence, async () => new Response("pdf", { headers: { "content-type": "application/pdf" } }))).resolves.toMatchObject({ status: "open_access_available" });
  });
});
