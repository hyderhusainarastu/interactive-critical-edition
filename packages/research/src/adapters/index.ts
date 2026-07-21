import type { SourceAdapter } from "../types";
import {
  CrossrefAdapter,
  GoogleBooksAdapter,
  OpenAlexAdapter,
  OpenLibraryAdapter,
  SemanticScholarAdapter,
} from "./scholarly";
import { TavilyAdapter, YouTubeAdapter } from "./web";
import { BlueskyAdapter, MastodonAdapter } from "./social";

export * from "./base";
export * from "./scholarly";
export * from "./web";
export * from "./social";

/** Every adapter, in a stable order (scholarly → web → social). */
export function allAdapters(): SourceAdapter[] {
  return [
    new CrossrefAdapter(),
    new OpenAlexAdapter(),
    new OpenLibraryAdapter(),
    new GoogleBooksAdapter(),
    new SemanticScholarAdapter(),
    new TavilyAdapter(),
    new YouTubeAdapter(),
    new MastodonAdapter(),
    new BlueskyAdapter(),
  ];
}

/** Only the adapters usable in this environment; the rest still get a
 *  `disabled` attempt recorded when the orchestrator asks them to search. */
export function enabledAdapters(): SourceAdapter[] {
  return allAdapters().filter((a) => a.isEnabled());
}
