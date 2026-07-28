/**
 * Capped, screen-space HTML label overlay — charter §10 ("Labels"):
 *
 *   - Always show: root, selected, hovered/focused, search target, direct
 *     neighbors of the selected node.
 *   - Plus a capped priority set (<=20 desktop, <=10 mobile), ranked by
 *     degree.
 *   - One shared HTML layer with collision avoidance, NOT one SpriteText
 *     object per node.
 *   - Root/selected 16px semibold, priority 13px, secondary 12px, max two
 *     lines, dark translucent plate, 1px border, 6px padding.
 *
 * Ported verbatim from `prototypes/graph-bakeoff/src/protoA/labelLayer.ts`
 * per spec §1.1 — zero product-specific logic, already generic over
 * `LabelCandidate`.
 *
 * Positions are pushed imperatively from the scene's own rAF loop (via
 * `update()`), never through React state — this runs every frame the
 * camera moves, so it must stay off the React render path entirely
 * (charter §14: "No React state updates ... in the frame loop").
 *
 * Collision avoidance here is a deliberately simple greedy AABB check
 * (skip a lower-priority candidate whose box overlaps an already-placed
 * one) rather than a force-directed label layout — enough to satisfy
 * "collision-avoided" without the added complexity/cost a full label
 * physics pass would add to every frame.
 *
 * Keyboard/tap availability (charter §10: "Labels must be available on
 * keyboard focus and tap, not hover alone"): this layer renders whatever
 * `alwaysShow`/priority candidates it is given — the scene/interaction
 * layer (`KnowledgeMapScene.tsx`) is responsible for including the
 * keyboard-focused or tapped node's id among those candidates, the same
 * way it already includes the hovered node's id; this module itself has
 * no notion of hover vs. focus vs. tap, only "should this label show".
 */

export type LabelTier = "primary" | "priority" | "secondary";

export interface LabelCandidate {
  id: string;
  text: string;
  /** Screen-space pixel position (already projected via
   * `graph2ScreenCoords`). */
  x: number;
  y: number;
  /** True for root/selected/hovered/search-target/direct-neighbor — always
   * shown, never subject to the priority cap. */
  alwaysShow: boolean;
  /** Used only to rank the fill-to-cap priority set when `alwaysShow` is
   * false. */
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

export class LabelLayer {
  private readonly root: HTMLDivElement;
  private readonly elements = new Map<string, HTMLDivElement>();
  private disposed = false;

  constructor(container: HTMLElement) {
    this.root = document.createElement("div");
    this.root.dataset.testid = "knowledge-map-label-layer";
    this.root.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:2;";
    container.appendChild(this.root);
  }

  /** `maxPriorityLabels` should be 20 for desktop widths, 10 for mobile
   * (charter §10) — the caller decides based on its own viewport width. */
  update(candidates: readonly LabelCandidate[], maxPriorityLabels: number, containerWidth: number, containerHeight: number): void {
    if (this.disposed) return;

    const margin = 120;
    const onScreen = candidates.filter(
      (c) => Number.isFinite(c.x) && Number.isFinite(c.y) && c.x > -margin && c.x < containerWidth + margin && c.y > -margin && c.y < containerHeight + margin,
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
      // Always-show labels are never dropped for collision (root/selection
      // must stay legible); only the fill-to-cap priority set yields.
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
    this.elements.clear();
    this.root.remove();
  }
}
