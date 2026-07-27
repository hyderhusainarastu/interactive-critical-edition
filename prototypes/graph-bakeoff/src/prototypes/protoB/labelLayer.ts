/**
 * Capped, screen-space HTML label overlay for Prototype B — same approach as
 * Prototype A (charter §10 "Labels"): one shared DOM layer with greedy AABB
 * collision avoidance, never one per-node 3D sprite/text mesh.
 *
 * Always shown (never subject to the priority cap): root, selected,
 * hovered/focused. A capped priority set (<=20 desktop, <=10 mobile per
 * charter §10) fills in by degree for the rest. Positions are pushed
 * imperatively from the scene's own `useFrame` loop, never through React
 * state (charter §14: "No React state updates ... in the frame loop").
 */

export type LabelTier = "primary" | "priority" | "secondary";

export interface LabelCandidate {
  id: string;
  text: string;
  /** Screen-space pixel position already projected from world space. */
  x: number;
  y: number;
  alwaysShow: boolean;
  degree: number;
  tier: LabelTier;
}

const TIER_FONT_PX: Record<LabelTier, number> = { primary: 16, priority: 13, secondary: 12 };
const TIER_WEIGHT: Record<LabelTier, string> = { primary: "600", priority: "500", secondary: "400" };
const MAX_LABEL_WIDTH_PX = 160;
const LINE_HEIGHT_PX = 15;
const MAX_LINES = 2;

interface PlacedBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function boxesOverlap(a: PlacedBox, b: PlacedBox): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

export class LabelLayerB {
  private readonly root: HTMLDivElement;
  private readonly elements = new Map<string, HTMLDivElement>();
  private disposed = false;

  constructor(container: HTMLElement) {
    this.root = document.createElement("div");
    this.root.dataset.testid = "proto-b-label-layer";
    this.root.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:2;";
    container.appendChild(this.root);
  }

  /** `maxPriorityLabels` should be 20 for desktop widths, 10 for mobile
   * (charter §10) — the caller decides based on its own viewport width. */
  update(candidates: readonly LabelCandidate[], maxPriorityLabels: number, containerWidth: number, containerHeight: number): void {
    if (this.disposed) return;

    const margin = 120;
    const onScreen = candidates.filter(
      (c) =>
        Number.isFinite(c.x) &&
        Number.isFinite(c.y) &&
        c.x > -margin &&
        c.x < containerWidth + margin &&
        c.y > -margin &&
        c.y < containerHeight + margin,
    );

    const always = onScreen.filter((c) => c.alwaysShow);
    const rest = onScreen
      .filter((c) => !c.alwaysShow)
      .sort((a, b) => b.degree - a.degree)
      .slice(0, Math.max(0, maxPriorityLabels));

    const toShow = [...always, ...rest];
    const placed: PlacedBox[] = [];
    const visibleIds = new Set<string>();

    for (const candidate of toShow) {
      const halfWidth = MAX_LABEL_WIDTH_PX / 2;
      const box: PlacedBox = {
        left: candidate.x - halfWidth,
        right: candidate.x + halfWidth,
        top: candidate.y,
        bottom: candidate.y + LINE_HEIGHT_PX * MAX_LINES,
      };
      if (!candidate.alwaysShow && placed.some((p) => boxesOverlap(p, box))) continue;
      placed.push(box);
      visibleIds.add(candidate.id);
      this.place(candidate);
    }

    for (const [id, el] of this.elements) {
      if (!visibleIds.has(id)) {
        el.remove();
        this.elements.delete(id);
      }
    }
  }

  private place(candidate: LabelCandidate): void {
    let el = this.elements.get(candidate.id);
    if (!el) {
      el = document.createElement("div");
      el.dataset.labelNodeId = candidate.id;
      el.tabIndex = -1;
      el.style.cssText =
        "position:absolute;transform-origin:top left;max-width:" +
        MAX_LABEL_WIDTH_PX +
        "px;background:rgba(11,16,32,0.72);border:1px solid rgba(167,182,194,0.35);" +
        "border-radius:4px;padding:6px;color:#FDF8EE;font-family:system-ui,sans-serif;" +
        "line-height:" +
        LINE_HEIGHT_PX +
        "px;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:" +
        MAX_LINES +
        ";overflow:hidden;white-space:normal;";
      this.root.appendChild(el);
      this.elements.set(candidate.id, el);
    }
    el.style.transform = `translate(${Math.round(candidate.x - MAX_LABEL_WIDTH_PX / 2)}px, ${Math.round(candidate.y)}px)`;
    el.style.fontSize = `${TIER_FONT_PX[candidate.tier]}px`;
    el.style.fontWeight = TIER_WEIGHT[candidate.tier];
    if (el.textContent !== candidate.text) el.textContent = candidate.text;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const el of this.elements.values()) el.remove();
    this.elements.clear();
    this.root.remove();
  }
}
