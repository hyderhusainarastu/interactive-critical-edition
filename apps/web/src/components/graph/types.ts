export type NodeState = "primary" | "read" | "reading" | "unread" | "missing";

export interface GraphNode {
  id: string;
  label: string;
  type: "work" | "reference";
  state: NodeState;
  authors: string | null;
  year: number | null;
  url: string | null;
}

export interface GraphLink {
  source: string;
  target: string;
  edgeType: string;
  category: string | null;
  confidence: number;
}

export interface GraphData {
  title: string;
  analysisStatus?: string;
  nodes: GraphNode[];
  links: GraphLink[];
  stats: { works: number; references: number; missing: number; read: number };
}

// State → palette token + human label. Color is never the only signal —
// the table fallback and the node labels carry the same meaning (plan §20).
export const STATE_META: Record<NodeState, { label: string; colorVar: string }> = {
  primary: { label: "Your work", colorVar: "--color-accent-ink" },
  read: { label: "Read", colorVar: "--color-accent-green" },
  reading: { label: "Reading", colorVar: "--color-highlight" },
  unread: { label: "In library, unread", colorVar: "--color-accent-umber" },
  missing: { label: "Referenced, not acquired", colorVar: "--color-accent-burgundy" },
};

export const STATE_ORDER: NodeState[] = ["primary", "reading", "unread", "read", "missing"];

export function edgeTypeLabel(edgeType: string): string {
  return edgeType.replace(/_/g, " ");
}
