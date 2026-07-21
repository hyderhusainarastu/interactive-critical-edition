import { normalizeCslJson, type CslJson } from "./writer";

const REQUEST_TIMEOUT_MS = 6_000;

async function readJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Citation lookup failed (${response.status}).`);
  return response.json();
}

function crossrefToCsl(value: unknown): CslJson | null {
  const message = (value as { message?: Record<string, unknown> })?.message;
  if (!message) return null;
  const authors = Array.isArray(message.author) ? message.author.map((author) => {
    const item = author as Record<string, unknown>;
    return { family: typeof item.family === "string" ? item.family : undefined, given: typeof item.given === "string" ? item.given : undefined };
  }) : undefined;
  return normalizeCslJson({
    type: Array.isArray(message.type) ? message.type[0] : message.type,
    title: Array.isArray(message.title) ? message.title[0] : message.title,
    author: authors,
    issued: message.issued ?? message.published,
    DOI: message.DOI,
    URL: message.URL,
    "container-title": Array.isArray(message["container-title"]) ? message["container-title"][0] : message["container-title"],
    publisher: message.publisher,
    volume: message.volume,
    issue: message.issue,
    page: message.page,
  });
}

export async function resolveCitation(identifier: string, kind: "doi" | "isbn" | "title"): Promise<CslJson[]> {
  const input = identifier.trim();
  if (!input) return [];
  if (kind === "doi") {
    const doi = input.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "");
    const result = crossrefToCsl(await readJson(`https://api.crossref.org/works/${encodeURIComponent(doi)}`));
    return result ? [result] : [];
  }
  if (kind === "isbn") {
    const isbn = input.replace(/[^0-9Xx]/g, "");
    const data = await readJson(`https://openlibrary.org/api/books?bibkeys=ISBN:${encodeURIComponent(isbn)}&format=json&jscmd=data`) as Record<string, unknown>;
    const book = data[`ISBN:${isbn}`] as Record<string, unknown> | undefined;
    if (!book) return [];
    const authors = Array.isArray(book.authors) ? book.authors.map((author) => ({ literal: (author as { name?: string }).name })) : undefined;
    const citation = normalizeCslJson({
      type: "book",
      title: book.title,
      author: authors,
      ISBN: isbn,
      publisher: Array.isArray(book.publishers) ? (book.publishers[0] as { name?: string })?.name : undefined,
      issued: typeof book.publish_date === "string" && /\d{4}/.test(book.publish_date) ? { "date-parts": [[Number(book.publish_date.match(/\d{4}/)?.[0])]] } : undefined,
      URL: typeof book.url === "string" ? `https://openlibrary.org${book.url}` : undefined,
    });
    return citation ? [citation] : [];
  }
  const data = await readJson(`https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(input)}&rows=3`) as { message?: { items?: unknown[] } };
  return (data.message?.items ?? []).map(crossrefToCsl).filter((citation): citation is CslJson => Boolean(citation));
}
