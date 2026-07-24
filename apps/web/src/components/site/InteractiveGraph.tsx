"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The interactive 3D knowledge graph, ported unchanged from the owner's
 * campaign site (`palimnote-campaign/app/ProductShowcase.tsx`).
 *
 * "Unchanged" is deliberate and load-bearing here — the owner asked for
 * this component exactly as it was. The node set, edge set, entity and
 * relation palettes, the yaw/pitch/zoom projection, the perspective and
 * depth-alpha maths, draw order, label placement, hit-testing radii, and
 * every pointer/wheel/keyboard handler are byte-identical to the source.
 *
 * Two edits were made, both outside the scene itself, and both recorded
 * here rather than made silently:
 *   1. The chrome badge text, which read "Working product · Phase 9" — a
 *      stale label, since the app has since shipped well past that phase.
 *   2. `role="cell"` / `role="columnheader"` on the accessible-list
 *      view's cells. `role="row"` requires cell children; without them
 *      axe's `aria-required-children` (wcag2a) fails, which would break
 *      the landing page's zero-violation gate in
 *      apps/web/e2e/landing.spec.ts. This is a strict accessibility
 *      correction to markup, not a change to what is rendered.
 *
 * No WebGL and no third-party graph library: this is a hand-rolled 2D
 * canvas projection of 3D coordinates, which is also why it can live on
 * a public page without the bundle cost of the authenticated
 * `/graph` view's `react-force-graph-3d` scene.
 */

type EntityType = "work" | "person" | "concept" | "tradition" | "debate" | "passage" | "annotation" | "source" | "route";
type GraphNode = { id: string; label: string; type: EntityType; x: number; y: number; z: number; state?: string; note: string };
type RelationGroup = "textual" | "intellectual" | "contextual" | "bibliographic";
type GraphEdge = { source: string; target: string; type: string; group: RelationGroup };

const graphNodes: GraphNode[] = [
  { id: "vice", label: "Vice and Reason", type: "work", x: 0, y: 0, z: 20, state: "Your work", note: "Primary work and center of the current graph." },
  { id: "vico", label: "Giambattista Vico", type: "person", x: -120, y: -105, z: 40, note: "Author and historical figure." },
  { id: "aristotle", label: "Aristotle", type: "person", x: 140, y: -110, z: -20, note: "Prerequisite figure for virtue and practical reason." },
  { id: "ethics", label: "Nicomachean Ethics", type: "work", x: 180, y: 30, z: 60, state: "Completed", note: "Essential background; available in the reader’s Library." },
  { id: "newscience", label: "New Science", type: "work", x: -190, y: 35, z: 10, state: "Reading", note: "Related primary work grouped under canonical identity." },
  { id: "wisdom", label: "Practical wisdom", type: "concept", x: 90, y: 145, z: 20, note: "Concept with mastery and prerequisite relations." },
  { id: "viceconcept", label: "Vice", type: "concept", x: -10, y: 175, z: -60, note: "Central concept at the selected passage." },
  { id: "formation", label: "Moral formation", type: "concept", x: -130, y: 135, z: 60, note: "Conceptual context shared by several works." },
  { id: "humanism", label: "Civic humanism", type: "tradition", x: -245, y: -95, z: -70, note: "Historical tradition providing context." },
  { id: "virtue", label: "Virtue ethics", type: "tradition", x: 260, y: -60, z: 5, note: "Tradition connecting Aristotle, lectures, and contemporary debate." },
  { id: "rationalism", label: "Moral rationalism", type: "debate", x: 20, y: -190, z: -35, note: "Debate contested by the central work." },
  { id: "motivation", label: "Knowledge vs motivation", type: "debate", x: 150, y: -175, z: 80, note: "Contemporary framing found across public discussion." },
  { id: "p14", label: "§3 · p.14", type: "passage", x: -40, y: 70, z: 145, note: "Passage anchor shared by annotations and evidence spans." },
  { id: "p19", label: "§4 · p.19", type: "passage", x: -85, y: -20, z: -145, note: "Passage anchor on formation and attention." },
  { id: "article", label: "Peer-reviewed analysis", type: "work", x: 235, y: 115, z: -90, state: "Reading", note: "Authority A source; full text inspected." },
  { id: "lecture", label: "Professor lecture", type: "work", x: 255, y: 100, z: 95, state: "To read", note: "University YouTube lecture; verified professor, not peer reviewed." },
  { id: "social", label: "Public discussion", type: "work", x: 120, y: -265, z: -75, state: "Unreviewed", note: "Social source retained as a reception signal only." },
  { id: "verene", label: "Donald P. Verene", type: "person", x: -250, y: 105, z: 85, note: "Interpreter connected to Vico scholarship." },
  { id: "study", label: "Historical study", type: "work", x: -300, y: 20, z: 110, state: "To read", note: "Academic-press historical context." },
  { id: "imagination", label: "Imagination", type: "concept", x: -210, y: 205, z: -40, note: "Concept linking Vico, formation, and interpretation." },
  { id: "prudence", label: "Phronēsis", type: "concept", x: 210, y: 205, z: 15, note: "Conceptual identity connected to practical wisdom." },
  { id: "education", label: "Moral education", type: "debate", x: -30, y: 270, z: 95, note: "Debate joining virtue, formation, and knowledge." },
  { id: "translator", label: "Translator", type: "person", x: -145, y: -175, z: 125, note: "Edition and translation relation." },
  { id: "edition", label: "Critical edition", type: "work", x: -235, y: -155, z: -110, state: "In library", note: "Specific edition grouped beneath its canonical work." },
  { id: "lecture2", label: "Seminar recording", type: "work", x: 310, y: 5, z: -150, state: "Missing", note: "Referenced but not yet acquired." },
  { id: "context", label: "Early modern Naples", type: "concept", x: -320, y: -80, z: 35, note: "Historical context entity." },
  { id: "comparison", label: "Comparative ethics", type: "debate", x: 300, y: -175, z: 130, note: "Optional comparative route." },
  { id: "ann14", label: "Annotation · practical wisdom", type: "annotation", x: 70, y: 85, z: -180, note: "Passage-bound annotation with explicit evidence, confidence, and correction state." },
  { id: "sourcehub", label: "Canonical source record", type: "source", x: 320, y: 150, z: 35, state: "Verified identity", note: "Shared source identity preserving provenance, credibility dimensions, and every retained reason." },
  { id: "routecore", label: "Graduate reading route", type: "route", x: -280, y: 205, z: -125, state: "Active route", note: "Ordered prerequisites and follow-up sources that always return to the selected passage." },
];

const graphEdges: GraphEdge[] = [
  { source: "vice", target: "vico", type: "authorship", group: "bibliographic" },
  { source: "vice", target: "p14", type: "has passage", group: "textual" },
  { source: "vice", target: "p19", type: "has passage", group: "textual" },
  { source: "vice", target: "ethics", type: "cites", group: "textual" },
  { source: "p14", target: "ethics", type: "quotes", group: "textual" },
  { source: "ethics", target: "aristotle", type: "authorship", group: "bibliographic" },
  { source: "ethics", target: "wisdom", type: "defines", group: "intellectual" },
  { source: "wisdom", target: "prudence", type: "concept identity", group: "intellectual" },
  { source: "ethics", target: "virtue", type: "anchors tradition", group: "contextual" },
  { source: "ethics", target: "vice", type: "is prerequisite for", group: "intellectual" },
  { source: "vice", target: "newscience", type: "responds to", group: "intellectual" },
  { source: "newscience", target: "vico", type: "authorship", group: "bibliographic" },
  { source: "newscience", target: "humanism", type: "provides context for", group: "contextual" },
  { source: "newscience", target: "imagination", type: "influences", group: "intellectual" },
  { source: "humanism", target: "context", type: "historical context", group: "contextual" },
  { source: "study", target: "newscience", type: "interprets", group: "intellectual" },
  { source: "study", target: "verene", type: "authorship", group: "bibliographic" },
  { source: "study", target: "vice", type: "is recommended by", group: "bibliographic" },
  { source: "article", target: "p14", type: "interprets", group: "intellectual" },
  { source: "article", target: "rationalism", type: "criticizes", group: "intellectual" },
  { source: "article", target: "wisdom", type: "provides context for", group: "contextual" },
  { source: "lecture", target: "ethics", type: "interprets", group: "intellectual" },
  { source: "lecture", target: "virtue", type: "teaches", group: "contextual" },
  { source: "lecture", target: "vice", type: "is recommended by", group: "bibliographic" },
  { source: "social", target: "motivation", type: "raises debate", group: "contextual" },
  { source: "social", target: "vice", type: "is comparable to", group: "intellectual" },
  { source: "motivation", target: "rationalism", type: "disagrees with", group: "intellectual" },
  { source: "rationalism", target: "vice", type: "polemical target", group: "intellectual" },
  { source: "viceconcept", target: "formation", type: "presupposes", group: "intellectual" },
  { source: "formation", target: "education", type: "provides context for", group: "contextual" },
  { source: "education", target: "virtue", type: "belongs to tradition", group: "contextual" },
  { source: "p19", target: "formation", type: "explains concept", group: "textual" },
  { source: "edition", target: "newscience", type: "is edition of", group: "bibliographic" },
  { source: "edition", target: "translator", type: "translates", group: "bibliographic" },
  { source: "lecture2", target: "aristotle", type: "interprets", group: "intellectual" },
  { source: "comparison", target: "virtue", type: "is comparable to", group: "intellectual" },
  { source: "comparison", target: "motivation", type: "responds to", group: "intellectual" },
  { source: "imagination", target: "formation", type: "influences", group: "intellectual" },
  { source: "ann14", target: "p14", type: "annotates", group: "textual" },
  { source: "ann14", target: "sourcehub", type: "supported by", group: "bibliographic" },
  { source: "sourcehub", target: "article", type: "resolves to source", group: "bibliographic" },
  { source: "sourcehub", target: "lecture", type: "resolves to source", group: "bibliographic" },
  { source: "sourcehub", target: "social", type: "resolves to source", group: "bibliographic" },
  { source: "routecore", target: "p14", type: "begins at", group: "textual" },
  { source: "routecore", target: "ethics", type: "orders before", group: "intellectual" },
  { source: "routecore", target: "article", type: "orders alongside", group: "intellectual" },
];

const entityColors: Record<EntityType, string> = { work: "#d3af6d", person: "#8aa9be", concept: "#9ab29e", tradition: "#b68a72", debate: "#bd7f89", passage: "#e5dac4", annotation: "#a98757", source: "#718b9a", route: "#c9a227" };
const relationColors: Record<RelationGroup, string> = { textual: "#d3af6d", intellectual: "#91abbf", contextual: "#96ab96", bibliographic: "#b9858e" };

export function InteractiveGraphRendering() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef({ yaw: -0.35, pitch: 0.18, zoom: 1.05 });
  const dragRef = useRef({ down: false, moved: false, x: 0, y: 0 });
  const pointsRef = useRef<Array<{ node: GraphNode; x: number; y: number; r: number }>>([]);
  const [selected, setSelected] = useState<GraphNode>(graphNodes[0]);
  const [view, setView] = useState<"graph" | "table">("graph");

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const width = Math.max(320, wrap.clientWidth);
    const height = Math.max(420, wrap.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);
    const { yaw, pitch, zoom } = viewRef.current;
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const projected = graphNodes.map((node) => {
      const x1 = node.x * cy - node.z * sy;
      const z1 = node.x * sy + node.z * cy;
      const y1 = node.y * cp - z1 * sp;
      const z2 = node.y * sp + z1 * cp;
      const perspective = (520 / (520 + z2)) * zoom;
      return { node, x: width / 2 + x1 * perspective, y: height / 2 + y1 * perspective, z: z2, r: (node.type === "work" ? 8 : node.type === "passage" ? 5 : 6) * Math.max(.75, perspective) };
    });
    const byId = new Map(projected.map((point) => [point.node.id, point]));
    for (const edge of graphEdges) {
      const a = byId.get(edge.source), b = byId.get(edge.target);
      if (!a || !b) continue;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = `${relationColors[edge.group]}75`;
      ctx.lineWidth = edge.source === selected.id || edge.target === selected.id ? 1.7 : .65;
      ctx.stroke();
    }
    projected.sort((a, b) => a.z - b.z);
    for (const point of projected) {
      const isSelected = point.node.id === selected.id;
      ctx.beginPath();
      ctx.arc(point.x, point.y, isSelected ? point.r + 4 : point.r, 0, Math.PI * 2);
      ctx.fillStyle = entityColors[point.node.type];
      ctx.globalAlpha = Math.max(.52, Math.min(1, .82 - point.z / 1000));
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = isSelected ? 2 : 1;
      ctx.strokeStyle = isSelected ? "#ffffff" : "#172838";
      ctx.stroke();
      if (isSelected || point.node.type === "work" || point.node.id === "wisdom" || point.node.id === "formation") {
        const label = point.node.label;
        ctx.font = `${isSelected ? "700" : "600"} ${isSelected ? 12 : 10}px Inter, sans-serif`;
        const textWidth = ctx.measureText(label).width;
        ctx.fillStyle = "rgba(23,40,56,.88)";
        ctx.fillRect(point.x + point.r + 5, point.y - 10, textWidth + 10, 19);
        ctx.fillStyle = "#f4f0e7";
        ctx.fillText(label, point.x + point.r + 10, point.y + 4);
      }
    }
    pointsRef.current = projected.map(({ node, x, y, r }) => ({ node, x, y, r: Math.max(r + 8, 14) }));
  }, [selected]);

  useEffect(() => {
    draw();
    const observer = new ResizeObserver(draw);
    if (wrapRef.current) observer.observe(wrapRef.current);
    return () => observer.disconnect();
  }, [draw]);

  function adjustView(yaw: number, pitch: number, zoom = 0) {
    viewRef.current.yaw += yaw;
    viewRef.current.pitch = Math.max(-1.15, Math.min(1.15, viewRef.current.pitch + pitch));
    viewRef.current.zoom = Math.max(.62, Math.min(1.8, viewRef.current.zoom + zoom));
    draw();
  }

  return (
    <div className="product-frame graph-rendering">
      <div className="app-chrome dark-chrome">
        <div className="app-brand"><span className="app-mark">P</span><b>Palimnote</b></div>
        <div className="global-nav"><span>Dashboard</span><span>Works</span><span>Library</span><span className="active">Graph</span><span>Upload</span></div>
        <span className="demo-badge">Working product · Beta</span>
      </div>
      <div className="graph-shell">
        <div className="graph-header">
          <div><small>YOUR INTELLECTUAL MAP</small><h3>Knowledge graph</h3><p>Works, passages, annotations, sources, routes, people, concepts, traditions, and debates—one evidence-linked field.</p></div>
          <div className="graph-view-toggle" role="group" aria-label="Graph view mode"><button type="button" aria-pressed={view === "graph"} onClick={() => setView("graph")}>3D scene</button><button type="button" aria-pressed={view === "table"} onClick={() => setView("table")}>Accessible list</button></div>
        </div>
        <div className="graph-summary"><span><b>30</b> entities</span><span><b>46</b> evidence-linked relations</span><span><b>31</b> relationship types</span><span><b>1</b> missing source</span></div>
        <div className="graph-main">
          {view === "graph" ? (
            <div className="canvas-wrap" ref={wrapRef}>
              <canvas
                ref={canvasRef}
                tabIndex={0}
                aria-label="Interactive three-dimensional knowledge graph. Drag or use arrow keys to rotate, scroll or use plus and minus to zoom, and select nodes for details."
                onPointerDown={(event) => { dragRef.current = { down: true, moved: false, x: event.clientX, y: event.clientY }; event.currentTarget.setPointerCapture(event.pointerId); }}
                onPointerMove={(event) => { const drag = dragRef.current; if (!drag.down) return; const dx = event.clientX - drag.x, dy = event.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true; drag.x = event.clientX; drag.y = event.clientY; adjustView(dx * .008, dy * .008); }}
                onPointerUp={(event) => { const drag = dragRef.current; drag.down = false; if (!drag.moved) { const rect = event.currentTarget.getBoundingClientRect(); const x = event.clientX - rect.left, y = event.clientY - rect.top; const hit = [...pointsRef.current].reverse().find((point) => Math.hypot(point.x - x, point.y - y) <= point.r); if (hit) setSelected(hit.node); } }}
                onWheel={(event) => { event.preventDefault(); adjustView(0, 0, event.deltaY > 0 ? -.08 : .08); }}
                onKeyDown={(event) => { if (event.key === "ArrowLeft") adjustView(-.12, 0); else if (event.key === "ArrowRight") adjustView(.12, 0); else if (event.key === "ArrowUp") adjustView(0, -.12); else if (event.key === "ArrowDown") adjustView(0, .12); else if (event.key === "+" || event.key === "=") adjustView(0, 0, .1); else if (event.key === "-") adjustView(0, 0, -.1); else return; event.preventDefault(); }}
              />
              <div className="graph-instructions">Drag to rotate · Scroll to zoom · Select any node</div>
              <button type="button" className="reset-graph" onClick={() => { viewRef.current = { yaw: -0.35, pitch: 0.18, zoom: 1.05 }; draw(); }}>Reset view</button>
            </div>
          ) : (
            <div className="graph-table" role="table" aria-label="Accessible graph relations">
              <div role="row"><b role="columnheader">From</b><b role="columnheader">Relationship</b><b role="columnheader">To</b><b role="columnheader">Entity</b></div>
              {graphEdges.map((edge, index) => {
                const source = graphNodes.find((node) => node.id === edge.source)!;
                const target = graphNodes.find((node) => node.id === edge.target)!;
                return <button role="row" type="button" key={`${edge.source}-${edge.target}-${index}`} onClick={() => setSelected(target)}><span role="cell">{source.label}</span><span role="cell">{edge.type}</span><span role="cell">{target.label}</span><span role="cell">{target.type}</span></button>;
              })}
            </div>
          )}
          <aside className="graph-detail" aria-live="polite">
            <span className={`entity-dot entity-${selected.type}`} />
            <small>{selected.type}</small>
            <h4>{selected.label}</h4>
            {selected.state && <span className="node-state">{selected.state}</span>}
            <p>{selected.note}</p>
            <dl>
              <div><dt>Incoming</dt><dd>{graphEdges.filter((edge) => edge.target === selected.id).length}</dd></div>
              <div><dt>Outgoing</dt><dd>{graphEdges.filter((edge) => edge.source === selected.id).length}</dd></div>
              <div><dt>Canonical ID</dt><dd>Shared</dd></div>
            </dl>
            <span className="graph-open-action">Open in workspace ↗</span>
          </aside>
        </div>
        <div className="graph-legends">
          <div><b>Entities</b>{(Object.keys(entityColors) as EntityType[]).map((type) => <span key={type}><i style={{ background: entityColors[type] }} />{type}</span>)}</div>
          <div><b>Relations</b>{["cites / quotes", "influences / presupposes", "criticizes / disagrees", "responds / interprets", "context / prerequisite", "translates / edition of", "authorship / recommended by"].map((label, index) => <span key={label}><i style={{ background: Object.values(relationColors)[index % 4] }} />{label}</span>)}</div>
        </div>
      </div>
      <div className="demo-footnote dark-footnote">Interactive rendering · Graph and accessible list use the identical entity and relation set.</div>
    </div>
  );
}
