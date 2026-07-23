import { afterEach, describe, expect, it, vi } from "vitest";
import { CrossrefSource } from "./crossref";
import { GoogleBooksSource } from "./googlebooks";
import { OpenAlexSource } from "./openalex";
import { OpenLibrarySource } from "./openlibrary";

/** Build a mock `fetch` returning a given status + json body — same
 *  pattern as packages/research/src/adapters/adapters.test.ts. */
function mockFetch(status: number, body: unknown) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

/** URLSearchParams serializes spaces as "+", which decodeURIComponent
 *  leaves untouched (it only decodes "%XX" sequences) — normalize both
 *  before asserting on a captured request URL's readable query text. */
function decodedQuery(url: string): string {
  return decodeURIComponent(url).replace(/\+/g, " ");
}

describe("D-20-81: widened top-N candidate scan at the real HTTP layer", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("CrossrefSource requests more than 1 row and resolves a runner-up (Brickhouse shape)", async () => {
    let requestedUrl = "";
    global.fetch = vi.fn(async (url: string) => {
      requestedUrl = String(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          message: {
            items: [
              { DOI: "10.1/wrong1", title: ["Weakness of Will in Ancient Ethics"] },
              { DOI: "10.1/wrong2", title: ["Aristotle on Moral Responsibility"] },
              {
                DOI: "10.5840/xyz",
                title: ["Does Aristotle Have a Consistent Account of Vice?"],
                author: [{ given: "Thomas C.", family: "Brickhouse" }],
                issued: { "date-parts": [[2003]] },
              },
            ],
          },
        }),
      };
    }) as unknown as typeof fetch;

    const record = await new CrossrefSource().search(
      'Brickhouse, Thomas C. and Nicholas D. Smith, "Does Aristotle Have a Consistent Account of Vice?" Review of Metaphysics 57 2003',
    );

    expect(record?.doi).toBe("10.5840/xyz");
    expect(record?.title).toBe("Does Aristotle Have a Consistent Account of Vice?");
    // rows is widened past 1 so a runner-up is even visible to pick from.
    expect(requestedUrl).toContain("rows=5");
  });

  it("CrossrefSource still rejects every candidate below the overlap threshold", async () => {
    global.fetch = mockFetch(200, {
      message: {
        items: [{ title: ["The Gay Science"] }, { title: ["Fear and Trembling"] }],
      },
    });
    const record = await new CrossrefSource().search("Critique of Pure Reason");
    expect(record).toBeNull();
  });

  it("OpenAlexSource resolves a runner-up out of a widened result page", async () => {
    global.fetch = mockFetch(200, {
      results: [
        { id: "W1", title: "An unrelated survey of ancient ethics" },
        {
          id: "W2",
          title: "Aristotle's Ethics",
          display_name: "Aristotle's Ethics",
          publication_year: 2000,
          authorships: [{ author: { display_name: "David Bostock" } }],
        },
      ],
    });
    // Realistic post-cleanQuery text (@ice/ingestion already strips the
    // publisher parenthetical for a footnote-style citation — see its own
    // comment on why: "publisher tokens swamp the title"). A query still
    // padded with publisher noise would itself dilute titleOverlap below
    // threshold regardless of provider — this is what actually reaches
    // resolveCitation in production.
    const record = await new OpenAlexSource().search("Bostock, David, Aristotle's Ethics 2000");
    expect(record?.title).toBe("Aristotle's Ethics");
    expect(record?.year).toBe(2000);
  });

  it("OpenLibrarySource resolves the real Bostock record past an unrelated top hit", async () => {
    global.fetch = mockFetch(200, {
      docs: [
        { title: "A History of Greek Philosophy" },
        {
          key: "/works/OL1W",
          title: "Aristotle's Ethics",
          author_name: ["David Bostock"],
          first_publish_year: 2000,
        },
      ],
    });
    const record = await new OpenLibrarySource().search("Bostock, David, Aristotle's Ethics 2000");
    expect(record?.title).toBe("Aristotle's Ethics");
    expect(record?.authors).toBe("David Bostock");
  });

  it("OpenLibrarySource strips a bare trailing year from its own outbound query (D-20-81 follow-up)", async () => {
    // Live-verified against the real API (see openlibrary.ts's comment):
    // Open Library's own /search.json returns ZERO docs for a query like
    // "Bostock, David, Aristotle's Ethics 2000" but resolves correctly once
    // the trailing year is dropped. Every citation query ends with exactly
    // this shape (cleanQuery's year-collapse), so this is what actually
    // makes the D-20-81 reordering effective for Open Library in practice.
    let requestedUrl = "";
    global.fetch = vi.fn(async (url: string) => {
      requestedUrl = String(url);
      return { ok: true, status: 200, json: async () => ({ docs: [] }) };
    }) as unknown as typeof fetch;

    await new OpenLibrarySource().search("Bostock, David, Aristotle's Ethics 2000");
    expect(requestedUrl).not.toContain("2000");
    expect(decodedQuery(requestedUrl)).toContain("Bostock, David, Aristotle's Ethics");
  });

  it("OpenLibrarySource still scores overlap against the citation's full original query, year included", async () => {
    // The year is stripped only from the outbound HTTP param, never from
    // what bestTitleMatch actually evaluates a candidate against.
    global.fetch = mockFetch(200, {
      docs: [{ key: "/works/OL1W", title: "Aristotle's Ethics", author_name: ["David Bostock"], first_publish_year: 2000 }],
    });
    const record = await new OpenLibrarySource().search("Bostock, David, Aristotle's Ethics 2000");
    expect(record?.title).toBe("Aristotle's Ethics");
  });

  it("OpenLibrarySource leaves a query alone when stripping the year would leave too little to search on", async () => {
    let requestedUrl = "";
    global.fetch = vi.fn(async (url: string) => {
      requestedUrl = String(url);
      return { ok: true, status: 200, json: async () => ({ docs: [] }) };
    }) as unknown as typeof fetch;

    await new OpenLibrarySource().search("Plato 1997");
    // Stripping "1997" would leave just "Plato" (<6 chars) — too little
    // signal to search on, so the original query is kept rather than
    // over-aggressively truncating a short citation.
    expect(decodedQuery(requestedUrl)).toContain("Plato 1997");
  });

  it("GoogleBooksSource is a real, working source (was entirely absent from resolveCitation before D-20-81)", async () => {
    global.fetch = mockFetch(200, {
      items: [
        { volumeInfo: { title: "An unrelated cookbook" } },
        {
          volumeInfo: {
            title: "Aristotelis Ethica Nicomachea",
            authors: ["Ingram Bywater"],
            publishedDate: "1894",
            industryIdentifiers: [{ type: "ISBN_13", identifier: "9780198140260" }],
            infoLink: "https://books.google.com/books?id=xyz",
          },
        },
      ],
    });
    const record = await new GoogleBooksSource().search("Bywater, Ingram, ed., Aristotelis Ethica Nicomachea 1894");
    expect(record?.title).toBe("Aristotelis Ethica Nicomachea");
    expect(record?.externalId).toBe("9780198140260");
    expect(record?.year).toBe(1894);
  });

  it("GoogleBooksSource still rejects a wrong-title candidate (guard not loosened)", async () => {
    global.fetch = mockFetch(200, {
      items: [{ volumeInfo: { title: "The Gay Science" } }],
    });
    const record = await new GoogleBooksSource().search("Aristotelis Ethica Nicomachea");
    expect(record).toBeNull();
  });

  it("GoogleBooksSource sends the API key only when GOOGLE_BOOKS_API_KEY is set", async () => {
    const original = process.env.GOOGLE_BOOKS_API_KEY;
    delete process.env.GOOGLE_BOOKS_API_KEY;
    let requestedUrl = "";
    global.fetch = vi.fn(async (url: string) => {
      requestedUrl = String(url);
      return { ok: true, status: 200, json: async () => ({ items: [] }) };
    }) as unknown as typeof fetch;

    await new GoogleBooksSource().search("some query");
    expect(requestedUrl).not.toContain("key=");

    process.env.GOOGLE_BOOKS_API_KEY = "test-key-123";
    await new GoogleBooksSource().search("some query");
    expect(requestedUrl).toContain("key=test-key-123");

    if (original === undefined) delete process.env.GOOGLE_BOOKS_API_KEY;
    else process.env.GOOGLE_BOOKS_API_KEY = original;
  });
});
