"use client";

import Link from "next/link";
import { useState } from "react";

type Project = { id: string; title: string; documentCount: number; updatedAt: string | Date };

export function WriterProjectsView({ initialProjects }: { initialProjects: Project[] }) {
  const [projects] = useState(initialProjects);
  const [creating, setCreating] = useState(false);
  async function createProject() {
    const title = window.prompt("Project title", "Untitled project");
    if (!title?.trim()) return;
    setCreating(true);
    try {
      const response = await fetch("/api/writer/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }) });
      const created = await response.json();
      if (!response.ok) throw new Error(created.error ?? "Could not create project.");
      window.location.assign(`/writer/${created.project.id}`);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Could not create project.");
    } finally { setCreating(false); }
  }
  return (
    <section className="mx-auto max-w-5xl px-4 py-8 sm:px-6" aria-labelledby="writer-title">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="text-sm font-medium text-[var(--color-accent)]">Private workspace</p><h1 id="writer-title" className="font-serif text-3xl font-semibold">Writer</h1><p className="mt-2 max-w-2xl text-sm text-[var(--color-text-muted)]">Draft in portable ProseMirror JSON, recover revisions, and build an MLA 9 Works Cited from your Library or imported metadata.</p></div>
        <button type="button" className="rounded bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50" onClick={createProject} disabled={creating}>{creating ? "Creating…" : "New project"}</button>
      </div>
      <ul className="mt-7 grid gap-3 sm:grid-cols-2" aria-label="Writing projects">
        {projects.map((project) => <li key={project.id}><Link href={`/writer/${project.id}`} className="block rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 transition hover:border-[var(--color-accent)]"><h2 className="font-medium">{project.title}</h2><p className="mt-1 text-sm text-[var(--color-text-muted)]">{project.documentCount} {project.documentCount === 1 ? "document" : "documents"} · updated {new Date(project.updatedAt).toLocaleDateString()}</p></Link></li>)}
        {!projects.length && <li className="rounded-lg border border-dashed border-[var(--color-border)] p-6 text-sm text-[var(--color-text-muted)]">No projects yet. Start a private draft when you are ready.</li>}
      </ul>
    </section>
  );
}
