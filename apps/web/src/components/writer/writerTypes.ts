/**
 * Shared shape definitions for `WriterEditor.tsx` and the panel components
 * it composes (`panels/SourcesEvidencePanel.tsx`, `panels/CitationsHistoryPanel.tsx`)
 * — split out so the panel components don't need to import from
 * `WriterEditor.tsx` itself (which would make it their own consumer,
 * a circular dependency), and so the two panels can't independently drift
 * from the shapes `WriterEditor.tsx` actually fetches.
 */

export type WriterDocument = { id: string; title: string; content: unknown; sortOrder: number };
export type WriterCitation = { id: string; cslJson: unknown; source: string };
export type WriterSource = { id: string; title: string; workId: string; workTitle: string; url: string | null; doi: string | null };
export type WriterRevision = { id: string; revision: number; reason: string; createdAt: string };

// Phase 28.5 (Writer evidence insertion).
export type ResearchProjectOption = { id: string; title: string };
export type EvidenceClaim = {
  id: string;
  workId: string | null;
  workTitle: string | null;
  claimText: string;
  claimNature: string;
  confidence: string;
  section: string;
  anchorState: string;
  sourceScope: string;
  verificationStatus: string;
  supportingExcerpt: string;
};
export type EvidenceCluster = { id: string; name: string; researchQuestion: string | null; verificationStatus: string; latestChamberId: string | null };
export type EvidenceChamberSummary = { id: string; clusterId: string; clusterName: string; question: string; verificationStatus: string };
export type EvidenceView = { researchProject: ResearchProjectOption; claims: EvidenceClaim[]; debateClusters: EvidenceCluster[]; chambers: EvidenceChamberSummary[] };
