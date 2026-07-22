#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "docs/project-status.json");
const outputPath = path.join(root, "progress-checklist.html");
const validStates = new Set(["complete", "in_progress", "awaiting_confirmation", "planned"]);
const validAuditStates = new Set(["operational", "release_gated", "incomplete"]);

function fail(message) {
  throw new Error(`Invalid project status: ${message}`);
}

function text(value, pathName) {
  if (typeof value !== "string" || value.trim() === "") fail(`${pathName} must be a non-empty string`);
  return value;
}

function validate(status) {
  if (!status || typeof status !== "object") fail("source must be an object");
  if (status.schemaVersion !== 1) fail("schemaVersion must equal 1");
  text(status.updated, "updated");
  text(status.project?.name, "project.name");
  text(status.current?.headline, "current.headline");
  text(status.current?.summary, "current.summary");
  text(status.current?.nextAction, "current.nextAction");
  if (!Number.isInteger(status.current?.phase)) fail("current.phase must be an integer");
  if (!Array.isArray(status.phases) || status.phases.length === 0) fail("phases must be a non-empty array");

  // The tracker is a living roadmap. Require its phase IDs to start at zero
  // and remain contiguous, but do not freeze validation to an old terminal
  // phase when a governed roadmap extension is added.
  const expectedNumbers = Array.from({ length: status.phases.length }, (_, index) => index);
  const actualNumbers = status.phases.map((phase) => phase?.number);
  if (JSON.stringify(actualNumbers) !== JSON.stringify(expectedNumbers)) fail(`phases must list phases 0 through ${status.phases.length - 1} exactly once, in order`);
  if (!actualNumbers.includes(status.current.phase)) fail("current.phase must exist in phases");

  for (const phase of status.phases) {
    text(phase.title, `phase ${phase.number}.title`);
    text(phase.summary, `phase ${phase.number}.summary`);
    text(phase.confirmation, `phase ${phase.number}.confirmation`);
    if (!validStates.has(phase.state)) fail(`phase ${phase.number}.state is not recognized`);
    if (phase.tag != null) text(phase.tag, `phase ${phase.number}.tag`);
    if (phase.evidence != null && (!Array.isArray(phase.evidence) || phase.evidence.some((item) => typeof item !== "string"))) {
      fail(`phase ${phase.number}.evidence must be an array of strings`);
    }
    if (phase.subphases != null) {
      if (!Array.isArray(phase.subphases) || phase.subphases.length === 0) fail(`phase ${phase.number}.subphases must be a non-empty array`);
      for (const subphase of phase.subphases) {
        text(subphase.id, `phase ${phase.number} subphase.id`);
        text(subphase.title, `phase ${phase.number} subphase.title`);
        text(subphase.summary, `phase ${phase.number} subphase.summary`);
        if (!validStates.has(subphase.state)) fail(`phase ${phase.number} subphase ${subphase.id}.state is not recognized`);
      }
    }
  }

  if (!status.operationalAudit || typeof status.operationalAudit !== "object") fail("operationalAudit must be an object");
  text(status.operationalAudit.performed, "operationalAudit.performed");
  text(status.operationalAudit.scope, "operationalAudit.scope");
  if (!Array.isArray(status.operationalAudit.items)) fail("operationalAudit.items must be an array");
  for (const item of status.operationalAudit.items) {
    text(item.surface, "operationalAudit item.surface");
    text(item.summary, "operationalAudit item.summary");
    if (!validAuditStates.has(item.state)) fail(`operationalAudit item ${item.surface}.state is not recognized`);
    if (!Array.isArray(item.evidence) || item.evidence.length === 0 || item.evidence.some((entry) => typeof entry !== "string")) {
      fail(`operationalAudit item ${item.surface}.evidence must be a non-empty array of strings`);
    }
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function label(value) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function evidenceList(items = []) {
  return items.length ? `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : "";
}

function renderPhase(phase) {
  const subphases = phase.subphases?.length
    ? `<ol class="subphases">${phase.subphases.map((subphase) => `<li class="subphase ${subphase.state}"><div><span class="subphase-id">${escapeHtml(subphase.id)}</span><h4>${escapeHtml(subphase.title)}</h4></div><span class="status ${subphase.state}">${escapeHtml(label(subphase.state))}</span><p>${escapeHtml(subphase.summary)}</p></li>`).join("")}</ol>`
    : "";
  const tag = phase.tag ? `<p class="meta">Tag: <code>${escapeHtml(phase.tag)}</code></p>` : "";
  return `<li class="phase ${phase.state}"><div class="phase-heading"><div><p class="eyebrow">Phase ${phase.number}</p><h3>${escapeHtml(phase.title)}</h3></div><span class="status ${phase.state}">${escapeHtml(label(phase.state))}</span></div><p>${escapeHtml(phase.summary)}</p>${tag}<p class="confirmation"><strong>Gate:</strong> ${escapeHtml(phase.confirmation)}</p>${evidenceList(phase.evidence)}${subphases}</li>`;
}

function renderAudit(item) {
  return `<article class="audit ${item.state}"><div class="audit-heading"><h3>${escapeHtml(item.surface)}</h3><span class="status ${item.state}">${escapeHtml(label(item.state))}</span></div><p>${escapeHtml(item.summary)}</p>${evidenceList(item.evidence)}</article>`;
}

function render(status) {
  const counts = Object.fromEntries([...validStates].map((state) => [state, status.phases.filter((phase) => phase.state === state).length]));
  const currentPhase = status.phases.find((phase) => phase.number === status.current.phase);
  const currentSubphases = currentPhase?.subphases ?? [];
  const completedSubphases = currentSubphases.filter((subphase) => subphase.state === "complete").length;
  const audit = status.operationalAudit.items.length
    ? status.operationalAudit.items.map(renderAudit).join("")
    : "<p class=\"empty\">The audit will appear here when its evidence has been recorded.</p>";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(status.project.name)} — Project status</title>
  <style>
    :root { --ink:#25211d; --muted:#675f56; --paper:#fcfaf5; --panel:#fffdf9; --line:#ded7cc; --accent:#7c3f20; --complete:#2f6b4d; --progress:#9a5a19; --planned:#676a78; --gated:#79527e; --incomplete:#a23d34; }
    * { box-sizing:border-box; } body { margin:0; background:var(--paper); color:var(--ink); font:16px/1.5 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    main { max-width:72rem; margin:auto; padding:clamp(1.25rem,4vw,4rem) clamp(1rem,4vw,2rem) 4rem; } h1,h2,h3,h4,p { margin-top:0; } h1 { font:700 clamp(2.2rem,6vw,4.8rem)/1.02 Georgia,serif; letter-spacing:-.04em; max-width:14ch; } h2 { font:700 clamp(1.55rem,3vw,2.35rem)/1.1 Georgia,serif; letter-spacing:-.025em; } h3 { font:700 1.22rem/1.2 Georgia,serif; } h4 { margin:0; font-size:1rem; } a { color:var(--accent); } code { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:.88em; }
    header { border-bottom:1px solid var(--line); padding-bottom:2rem; } .eyebrow { margin-bottom:.4rem; color:var(--accent); font-size:.78rem; font-weight:750; letter-spacing:.1em; text-transform:uppercase; } .lede { max-width:61ch; color:var(--muted); font-size:1.1rem; }
    section { margin-top:3.5rem; } .overview { display:grid; grid-template-columns:minmax(0,2fr) minmax(13rem,1fr); gap:1.5rem; align-items:stretch; } .card,.metric,.phase,.audit { border:1px solid var(--line); background:var(--panel); border-radius:.75rem; box-shadow:0 .3rem 1.2rem rgba(69,50,27,.045); } .card { padding:1.4rem; } .metric { display:grid; place-content:center; padding:1.4rem; text-align:center; } .metric strong { font:700 2.45rem/1 Georgia,serif; } .metric span { color:var(--muted); margin-top:.5rem; }
    .counts { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:.7rem; margin-top:1.3rem; } .count { padding:.75rem; border:1px solid var(--line); border-radius:.5rem; } .count strong,.count span { display:block; } .count strong { font-size:1.35rem; } .count span { color:var(--muted); font-size:.8rem; }
    .phases { list-style:none; display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:1rem; margin:0; padding:0; } .phase { padding:1.2rem; } .phase-heading,.audit-heading,.subphase>div { display:flex; gap:.75rem; justify-content:space-between; align-items:flex-start; } .phase h3 { margin-bottom:.55rem; } .phase .eyebrow { margin:.1rem 0 .25rem; } .phase>p:not(.eyebrow) { color:var(--muted); } .meta,.confirmation { color:var(--muted); font-size:.88rem; } .confirmation strong { color:var(--ink); }
    .status { display:inline-flex; flex:none; align-items:center; border-radius:999px; padding:.18rem .55rem; font-size:.72rem; font-weight:750; line-height:1.2; white-space:nowrap; } .status.complete { background:#e5f2e9; color:var(--complete); } .status.in_progress { background:#fff0d9; color:var(--progress); } .status.awaiting_confirmation { background:#eee7f4; color:var(--gated); } .status.planned { background:#ececf0; color:var(--planned); } .status.operational { background:#e5f2e9; color:var(--complete); } .status.release_gated { background:#eee7f4; color:var(--gated); } .status.incomplete { background:#f9e4e1; color:var(--incomplete); }
    ul { padding-left:1.2rem; } li+li { margin-top:.4rem; } .phase ul,.audit ul { color:var(--muted); font-size:.88rem; } .subphases { list-style:none; margin:1rem 0 0; padding:0; border-top:1px solid var(--line); } .subphase { padding:1rem 0 0; } .subphase+li { margin-top:0; border-top:1px solid var(--line); } .subphase h4 { margin:.15rem 0 .35rem; } .subphase p { margin:.5rem 0 0; color:var(--muted); font-size:.9rem; } .subphase-id { color:var(--accent); font-size:.78rem; font-weight:750; }
    .audit-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(15rem,1fr)); gap:1rem; } .audit { padding:1.2rem; } .audit p { color:var(--muted); } .empty { color:var(--muted); font-style:italic; } footer { margin-top:4rem; border-top:1px solid var(--line); padding-top:1rem; color:var(--muted); font-size:.88rem; }
    @media (max-width:44rem) { .overview,.phases { grid-template-columns:1fr; } .counts { grid-template-columns:repeat(2,minmax(0,1fr)); } } @media (prefers-reduced-motion:reduce) { *,*::before,*::after { scroll-behavior:auto!important; transition:none!important; } }
  </style>
</head>
<body>
  <main>
    <header>
      <p class="eyebrow">${escapeHtml(status.project.name)} · Generated project record</p>
      <h1>Progress, evidence, and the next gate.</h1>
      <p class="lede">This standalone checklist is generated from <code>docs/project-status.json</code>. The canonical narrative is <code>${escapeHtml(status.project.canonicalRecord)}</code>; the approved delivery plan is <code>${escapeHtml(status.project.architecturePlan)}</code>.</p>
    </header>
    <section class="overview" aria-labelledby="current-title">
      <div class="card">
        <p class="eyebrow">Current position</p>
        <h2 id="current-title">${escapeHtml(status.current.headline)}</h2>
        <p>${escapeHtml(status.current.summary)}</p>
        <p><strong>Next action:</strong> ${escapeHtml(status.current.nextAction)}</p>
        <div class="counts" aria-label="Phase totals">
          <div class="count"><strong>${counts.complete}</strong><span>complete</span></div>
          <div class="count"><strong>${counts.in_progress}</strong><span>in progress</span></div>
          <div class="count"><strong>${counts.awaiting_confirmation}</strong><span>awaiting confirmation</span></div>
          <div class="count"><strong>${counts.planned}</strong><span>planned</span></div>
        </div>
      </div>
      <div class="metric"><strong>${completedSubphases} / ${currentSubphases.length}</strong><span>current-phase subphases complete</span></div>
    </section>
    <section aria-labelledby="roadmap-title">
      <p class="eyebrow">Roadmap</p><h2 id="roadmap-title">Phases 0–${status.phases.at(-1)?.number ?? 0}</h2>
      <ol class="phases">${status.phases.map(renderPhase).join("")}</ol>
    </section>
    <section aria-labelledby="audit-title">
      <p class="eyebrow">Operational audit · ${escapeHtml(status.operationalAudit.performed)}</p><h2 id="audit-title">Released-surface evidence</h2>
      <p>${escapeHtml(status.operationalAudit.scope)}</p>
      <div class="audit-grid">${audit}</div>
    </section>
    <footer>Generated from <code>docs/project-status.json</code> on record date ${escapeHtml(status.updated)}. Run <code>pnpm generate:project-status</code> after editing the source; CI rejects a stale <code>progress-checklist.html</code>.</footer>
  </main>
</body>
</html>
`;
}

const checkOnly = process.argv.slice(2).includes("--check");
if (process.argv.slice(2).some((argument) => argument !== "--check")) {
  throw new Error("Usage: node scripts/generate-progress-checklist.mjs [--check]");
}

const status = JSON.parse(await readFile(sourcePath, "utf8"));
validate(status);
const output = render(status);
if (checkOnly) {
  const existing = await readFile(outputPath, "utf8").catch(() => "");
  if (existing !== output) {
    throw new Error("progress-checklist.html is stale. Run: pnpm generate:project-status");
  }
} else {
  await writeFile(outputPath, output);
}
