export type Position =
  | { kind: "pdf"; page: number }
  | { kind: "text"; paragraphIndex: number }
  | { kind: "processed"; pageIndex: number; textBlockId: string };

export interface HighlightRecord {
  id: string;
  anchor:
    | { kind: "pdf"; page: number; quote: string; prefix: string; suffix: string }
    | { kind: "text"; paragraphIndex: number; quote: string; prefix: string; suffix: string }
    | { kind: "processed"; pageIndex: number; textBlockId: string; quote: string; prefix: string; suffix: string };
  color: string;
  createdAt: string;
}

export interface NoteRecord {
  id: string;
  highlightId: string | null;
  highlightIds: string[];
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

export type RelationshipCategory =
  | "explicit_reference"
  | "secondary_scholarly_recommendation"
  | "historical_context"
  | "prerequisite"
  | "conceptual_influence"
  | "disagreement_polemical_target"
  | "interpretive_aid"
  | "parallel_comparison"
  | "optional_extension"
  | "ai_inferred";

export type VerificationStatus =
  | "unreviewed"
  | "user_verified"
  | "source_verified"
  | "disputed"
  | "rejected";

export type AnalysisStatus = "not_started" | "analyzing" | "complete" | "failed";

export interface AnnotationTarget {
  id: string;
  title: string | null;
  authors: string | null;
  year: number | null;
  url: string | null;
  doi: string | null;
  accessStatus: string;
  source: string;
}

export interface AnnotationAnchor {
  kind: "text";
  paragraphIndex: number;
  quote: string;
  prefix: string;
  suffix: string;
}

export interface AnnotationRecord {
  id: string;
  relationshipCategory: RelationshipCategory;
  targetLabel: string;
  anchor: AnnotationAnchor | null;
  extractedSourceText: string | null;
  explanation: string;
  confidence: number;
  modelUsed: string | null;
  promptVersion: string | null;
  isHeuristic: boolean;
  createdBy: "system" | "user" | "editor";
  verificationStatus: VerificationStatus;
  hidden: boolean;
  createdAt: string;
  target: AnnotationTarget | null;
}

export interface ReaderData {
  documentId: string;
  title: string;
  mimeType: string;
  extractedText: string | null;
  fileUrl: string | null;
  lastPosition: Position | null;
  analysisStatus: AnalysisStatus;
  analysisError: string | null;
  footnotes: FootnoteRecord[];
  highlights: HighlightRecord[];
  notes: NoteRecord[];
  bookmarks: BookmarkRecord[];
  annotations: AnnotationRecord[];
}

export type HighlightColor = "gold" | "green" | "ink" | "burgundy";
export const HIGHLIGHT_COLORS: HighlightColor[] = ["gold", "green", "ink", "burgundy"];
