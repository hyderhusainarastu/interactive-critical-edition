"use client";

import { developmentLog, type DevelopmentVersion } from "@/lib/developmentLog";
import { useScrollReveal } from "@/hooks/useScrollReveal";

function VersionEntry({
  entry,
  index,
}: {
  entry: DevelopmentVersion;
  index: number;
}) {
  const revealRef = useScrollReveal<HTMLElement>(index);
  const inProgress = entry.status === "in-progress";

  return (
    <article
      id={entry.version.replace(".", "")}
      ref={revealRef}
      className={`development-entry app-reveal ${inProgress ? "development-entry-current" : ""}`}
      aria-labelledby={`${entry.version}-title`}
    >
      <div className="development-marker" aria-hidden="true">
        <span />
      </div>
      <div className="development-entry-heading">
        <div>
          <p className="development-phase">{entry.phaseRange}</p>
          <h2 id={`${entry.version}-title`}>
            <span>{entry.version}</span>
            {entry.title}
          </h2>
        </div>
        <p className={`development-status ${inProgress ? "is-live" : ""}`}>
          {inProgress && <span aria-hidden="true" />}
          {inProgress ? "In progress" : "Released"}
        </p>
      </div>
      <p className="development-summary">{entry.summary}</p>
      {entry.highlights.length > 0 && (
        <ul className="development-highlights">
          {entry.highlights.map((highlight) => (
            <li key={highlight}>{highlight}</li>
          ))}
        </ul>
      )}
    </article>
  );
}

export function DevelopmentTimeline() {
  return (
    <div className="development-layout">
      <aside className="development-nav-wrap">
        <nav className="development-nav" aria-label="Development versions">
          <p>Release index</p>
          {developmentLog.map((entry) => (
            <a
              key={entry.version}
              href={`#${entry.version.replace(".", "")}`}
              aria-label={`${entry.version}: ${entry.title}`}
            >
              <span>{entry.version}</span>
              <small>{entry.status === "in-progress" ? "Now" : entry.phaseRange}</small>
            </a>
          ))}
        </nav>
      </aside>
      <div className="development-timeline app-reveal-stagger">
        {developmentLog.map((entry, index) => (
          <VersionEntry key={entry.version} entry={entry} index={index} />
        ))}
      </div>
    </div>
  );
}
