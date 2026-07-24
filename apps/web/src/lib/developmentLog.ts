export type DevelopmentStatus = "in-progress" | "released";

export interface DevelopmentVersion {
  version: `v.${number}`;
  phaseRange: string;
  status: DevelopmentStatus;
  title: string;
  summary: string;
  highlights: readonly string[];
}

/**
 * Public development history, newest first.
 *
 * Keep this deliberately higher-level than the internal project log: it is a
 * record of what readers can experience, not an infrastructure changelog.
 * While v.5 is in progress, append one concise highlight only after its lane
 * has shipped.
 */
export const developmentLog = [
  {
    version: "v.5",
    phaseRange: "Current development",
    status: "in-progress",
    title: "A more expressive scholarly workspace",
    summary:
      "The current release is reshaping Palimnote into a more tactile, readable, and responsive place to study difficult texts.",
    highlights: [
      "Introduced the editorial motion and interaction foundation, with reader-controlled motion and interface sound settings.",
      "Published the Beta v.5 badge and a public development timeline tracing Palimnote’s releases from foundation to the current work.",
      "Removed user-facing processing cost data while keeping analysis available without monetary figures.",
    ],
  },
  {
    version: "v.4",
    phaseRange: "Phases 19–23",
    status: "released",
    title: "Reliability, accessibility, and completion",
    summary:
      "A broad completion program made the working research environment more dependable, consistent, and accessible across its core reading flows.",
    highlights: [
      "Strengthened processing reliability and made document status easier to understand.",
      "Expanded keyboard, screen-reader, contrast, and responsive-layout coverage.",
      "Unified the product interface and hardened the paths readers use most often.",
    ],
  },
  {
    version: "v.3",
    phaseRange: "Phases 12–18",
    status: "released",
    title: "From edition to connected workspace",
    summary:
      "Palimnote grew beyond a single reading surface into a connected environment for writing, exploration, and questions grounded in a reader’s own library.",
    highlights: [
      "Added the Writer workspace for developing ideas alongside source material.",
      "Made relationships between works explorable through the research visualization.",
      "Introduced Ask Library for passage- and citation-grounded conversations.",
    ],
  },
  {
    version: "v.2",
    phaseRange: "Phases 8–11",
    status: "released",
    title: "A critical-edition learning workspace",
    summary:
      "The early reader became a more rigorous critical-edition pipeline and a personal learning workspace, taking on the Palimnote name.",
    highlights: [
      "Deepened structural analysis, citation resolution, and passage-anchored annotation.",
      "Added learning routes and workspace tools that preserve the path back to the source.",
      "Established Palimnote’s scholarly identity across the reading experience.",
    ],
  },
  {
    version: "v.1",
    phaseRange: "Phases 0–7",
    status: "released",
    title: "The foundation",
    summary:
      "The first release proved the central idea: a reader could upload a difficult work and receive a traceable study environment around it.",
    highlights: [
      "Established accounts, document upload, and the first interactive reader.",
      "Connected analysis, annotation, and a dependency-ordered reading roadmap.",
      "Built the initial public site and hardened the end-to-end foundation.",
    ],
  },
] as const satisfies readonly DevelopmentVersion[];
