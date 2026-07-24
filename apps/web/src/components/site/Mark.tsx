/**
 * The Palimnote mark: three ruled text lines beside an open margin
 * bracket — a page with its margin still available. Drawn entirely in CSS
 * (see `.mark` in apps/web/src/app/site-theme.css) so it inherits
 * `currentColor` and needs no image request. Ported from the owner's
 * campaign site; the same glyph is the site favicon.
 *
 * Decorative in every placement — the brand name is always adjacent as
 * real text — so it is hidden from assistive technology.
 */
export function Mark({ small = false }: { small?: boolean }) {
  return (
    <span className={small ? "mark mark-small" : "mark"} aria-hidden="true">
      <span className="mark-lines">
        <i />
        <i />
        <i />
      </span>
      <span className="mark-margin" />
    </span>
  );
}
