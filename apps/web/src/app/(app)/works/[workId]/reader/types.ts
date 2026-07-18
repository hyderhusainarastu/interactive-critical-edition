export type Position =
  | { kind: "pdf"; page: number }
  | { kind: "text"; paragraphIndex: number };

export interface HighlightRecord {
  id: string;
  anchor:
    | { kind: "pdf"; page: number; quote: string; prefix: string; suffix: string }
    | { kind: "text"; paragraphIndex: number; quote: string; prefix: string; suffix: string };
  color: string;
  createdAt: string;
}

export interface NoteRecord {
  id: string;
  highlightId: string | null;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface BookmarkRecord {
  id: string;
  position: Position;
  label: string | null;
  createdAt: string;
}

export interface FootnoteRecord {
  id: string;
  marker: string;
  content: string;
}

export interface ReaderData {
  documentId: string;
  title: string;
  mimeType: string;
  extractedText: string | null;
  fileUrl: string | null;
  lastPosition: Position | null;
  footnotes: FootnoteRecord[];
  highlights: HighlightRecord[];
  notes: NoteRecord[];
  bookmarks: BookmarkRecord[];
}

export type HighlightColor = "gold" | "green" | "ink" | "burgundy";
export const HIGHLIGHT_COLORS: HighlightColor[] = ["gold", "green", "ink", "burgundy"];
