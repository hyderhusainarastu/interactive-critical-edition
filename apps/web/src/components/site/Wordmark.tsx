"use client";

import Link from "next/link";
import { Mark } from "./Mark";

export function Wordmark({ href, small = true, className = "" }: { href: string; small?: boolean; className?: string }) {
  return (
    <Link href={href} data-sound="click" className={`wordmark ${className}`} aria-label="Palimnote home">
      <Mark small={small} />
      {/*
        `rail-label` (a bare marker class, no styling of its own outside the
        two ancestor-scoped rules in globals.css) lets a collapsed
        `WorkspaceRail` hide this text the same way it already hides the
        beta badge beside it, instead of leaving it to overflow the rail's
        own narrow collapsed width and visually bleed into the ContextBar's
        title next to it (Stage 3 verification finding, stage3-kmap-
        verification.md §6/stage5-research-verification.md's carried-
        forward header-shell defect). No-op everywhere else this component
        is used (e.g. `SiteHeader`), since `rail-label` only does anything
        inside `.workspace-rail`.
      */}
      <span aria-hidden="true" className="rail-label">{"Palimnote".split("").map((letter, index) => <span key={`${letter}-${index}`} className="wordmark-letter" style={{ "--wordmark-index": index } as React.CSSProperties}>{letter}</span>)}</span>
    </Link>
  );
}
