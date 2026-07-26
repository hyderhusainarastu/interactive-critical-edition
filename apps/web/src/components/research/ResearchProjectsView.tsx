"use client";

import Link from "next/link";
import { useState } from "react";

type Project = {
  id: string;
  title: string;
  summary?: string | null;
  memberCount: number;
  questionCount: number;
  updatedAt: string | Date;
  archivedAt?: string | Date | null;
};

export function ResearchProjectsView({ initialProjects }: { initialProjects: Project[] }) {
  const [projects, setProjects] = useState(initialProjects);
  const [archivedProjects, setArchivedProjects] = useState<Project[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [loadingArchived, setLoadingArchived] = useState(false);
  const [creating, setCreating] = useState(false);

  async function loadArchived() {
    setLoadingArchived(true);
    try {
      const response = await fetch("/api/research/projects?archived=true");
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not load archived projects.");
      setArchivedProjects((body.projects as Project[]).filter((project) => project.archivedAt));
      setShowArchived(true);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Could not load archived projects.");
    } finally {
      setLoadingArchived(false);
    }
  }

  async function restoreProject(project: Project) {
    const response = await fetch(`/api/research/projects/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: false }),
    });
    const body = await response.json();
    if (!response.ok) {
      window.alert(body.error ?? "Could not restore project.");
      return;
    }
    setArchivedProjects((current) => current.filter((item) => item.id !== project.id));
    setProjects((current) => [...current, body.project].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()));
  }

  async function createProject() {
    const title = window.prompt("Project title", "Untitled research project");
    if (!title?.trim()) return;
    setCreating(true);
    try {
      const response = await fetch("/api/research/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not create project.");
      window.location.assign(`/research/${body.project.id}`);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Could not create project.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <section className="mx-auto max-w-5xl px-4 py-8 sm:px-6" aria-labelledby="research-title">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-[var(--color-accent)]">Private workspace</p>
          <h1 id="research-title" className="font-serif text-3xl font-semibold">Research</h1>
          <p className="mt-2 max-w-2xl text-sm text-[var(--color-text-muted)]">
            Compare claims across your works: extract falsifiable assertions from a work&apos;s own text, every one grounded in a
            re-verified passage, confidence and provenance always visible.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button type="button" className="app-control app-press text-sm text-[var(--color-text-muted)] underline" onClick={loadArchived} disabled={loadingArchived}>
            {loadingArchived ? (
              <>
                <span className="app-shimmer inline-block h-4 w-24 rounded" aria-hidden />
                <span className="sr-only">Loading archived projects…</span>
              </>
            ) : (
              "Show archived projects"
            )}
          </button>
          <button
            type="button"
            className="app-control app-press rounded bg-[var(--color-accent-ink)] px-4 py-2 text-sm font-medium text-[var(--color-background)] disabled:opacity-50"
            onClick={createProject}
            disabled={creating}
          >
            {creating ? "Creating…" : "New project"}
          </button>
        </div>
      </div>
      <ul className="app-reveal-stagger mt-7 grid gap-3 sm:grid-cols-2" aria-label="Research projects">
        {projects.map((project) => (
          <li key={project.id} className="app-mount">
            <Link href={`/research/${project.id}`} className="app-card app-control app-lift app-press block rounded-lg p-4">
              <h2 className="font-medium">{project.title}</h2>
              {project.summary ? <p className="mt-1 text-sm text-[var(--color-text-muted)]">{project.summary}</p> : null}
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                {project.memberCount} {project.memberCount === 1 ? "member" : "members"} · {project.questionCount} {project.questionCount === 1 ? "question" : "questions"} · updated{" "}
                {new Date(project.updatedAt).toLocaleDateString()}
              </p>
            </Link>
          </li>
        ))}
        {!projects.length && <li className="app-empty app-mount rounded-lg p-6 text-sm text-[var(--color-text-muted)]">No research projects yet. Start one when you are ready to compare claims across your works.</li>}
      </ul>
      {showArchived && (
        <section className="app-panel-enter mt-8" aria-labelledby="archived-research-projects-title">
          <div className="flex items-center justify-between gap-3">
            <h2 id="archived-research-projects-title" className="font-serif text-xl font-semibold">Archived projects</h2>
            <button type="button" className="app-control app-press text-sm underline" onClick={() => setShowArchived(false)}>Hide</button>
          </div>
          {archivedProjects.length ? (
            <ul className="app-reveal-stagger mt-3 grid gap-3 sm:grid-cols-2">
              {archivedProjects.map((project) => (
                <li key={project.id} className="app-card app-mount rounded-lg p-4">
                  <h3 className="font-medium">{project.title}</h3>
                  <p className="mt-1 text-sm text-[var(--color-text-muted)]">Archived {project.archivedAt ? new Date(project.archivedAt).toLocaleDateString() : "recently"}</p>
                  <button type="button" className="app-control app-press mt-3 rounded border border-[var(--color-border)] px-3 py-1.5 text-sm" onClick={() => restoreProject(project)}>Restore project</button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="app-empty app-mount mt-3 rounded-lg px-5 py-8 text-sm text-[var(--color-text-muted)]">No archived projects.</p>
          )}
        </section>
      )}
    </section>
  );
}
