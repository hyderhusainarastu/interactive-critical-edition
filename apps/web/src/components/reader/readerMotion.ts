/** JavaScript scrollIntoView's explicit `smooth` value is not overridden by
 * CSS reduced-motion rules, so every programmatic reader jump checks both the
 * OS preference and the in-app motion preference before choosing behavior. */
export function readerScrollBehavior(): ScrollBehavior {
  if (typeof window === "undefined") return "auto";
  return document.documentElement.dataset.motion === "reduced"
    || window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";
}
