/**
 * Shared workspace-nav vocabulary (redesign-shell-spec.md §3.1). One place
 * defines the primary destinations, the Read subnav, and the active-state
 * rule, so `WorkspaceRail`, `MobileBottomNav`, and the command palette's
 * items prop can never independently drift from each other.
 */

export type WorkspaceNavKey = "home" | "read" | "research" | "write";

export interface WorkspaceNavItem {
  key: WorkspaceNavKey;
  href: string;
  label: string;
}

/**
 * Exactly the charter's four primary destinations (§6/"Target information
 * architecture"), Research/Write present only when their feature flag is on
 * — never a reserved-but-empty slot. Order is fixed: Home, Read, Research,
 * Write.
 */
export function buildWorkspaceNavItems({
  writerEnabled,
  researchEnabled,
}: {
  writerEnabled: boolean;
  researchEnabled: boolean;
}): WorkspaceNavItem[] {
  return [
    { key: "home", href: "/dashboard", label: "Home" },
    { key: "read", href: "/works", label: "Read" },
    ...(researchEnabled ? [{ key: "research" as const, href: "/research", label: "Research" }] : []),
    ...(writerEnabled ? [{ key: "write" as const, href: "/writer", label: "Write" }] : []),
  ];
}

export interface CommandPaletteNavItem {
  href: string;
  label: string;
  shortcut?: string;
}

/**
 * The command palette's own (larger) navigable-entry list — the palette is
 * explicitly the reachability backstop for everything that is no longer a
 * primary rail/bottom-nav item under the new IA (Library, Upload, Trash),
 * plus the global Knowledge Map entry point (§3.8) and Ask Library (§3.7).
 * The Upload shortcut ("U") is preserved unchanged from the pre-Stage-1
 * palette.
 */
export function buildCommandPaletteNavItems({
  writerEnabled,
  researchEnabled,
  ragEnabled,
  admin,
}: {
  writerEnabled: boolean;
  researchEnabled: boolean;
  ragEnabled: boolean;
  admin: boolean;
}): CommandPaletteNavItem[] {
  return [
    { href: "/dashboard", label: "Home" },
    { href: "/works", label: "Reading Queue" },
    { href: "/library", label: "Library" },
    { href: "/upload", label: "Upload", shortcut: "U" },
    { href: "/works/trash", label: "Trash" },
    { href: "/graph", label: "Knowledge Map" },
    ...(ragEnabled ? [{ href: "/ask-library", label: "Ask Library" }] : []),
    ...(researchEnabled ? [{ href: "/research", label: "Research" }] : []),
    ...(writerEnabled ? [{ href: "/writer", label: "Write" }] : []),
    ...(admin ? [{ href: "/admin", label: "Admin" }] : []),
  ];
}

/** The Read rail item's own subnav (§3.2) — Reading Queue and Library share
 *  the rail item's expandable group; Trash is rendered separately by callers
 *  as the "secondary Read management" entry per the charter's own wording. */
export const READ_SUBNAV: ReadonlyArray<{ href: string; label: string }> = [
  { href: "/works", label: "Reading Queue" },
  { href: "/library", label: "Library" },
  { href: "/upload", label: "Upload" },
];

/**
 * Shared active-state rule (factored out of the pre-Stage-1 `NavLink`, which
 * duplicated this once for the header and once for the mobile drawer).
 * `/dashboard` is deliberately exact-match only — every other href also
 * matches its own sub-routes.
 */
export function isNavItemActive(pathname: string, href: string): boolean {
  return pathname === href || (href !== "/dashboard" && pathname.startsWith(`${href}/`));
}

/** The Read primary item covers two route families (Reading Queue AND
 *  Library), unlike every other primary item's single href — used only for
 *  that item's own active-state highlighting in the rail/bottom nav. */
export function isReadSectionActive(pathname: string): boolean {
  return isNavItemActive(pathname, "/works") || pathname === "/library" || pathname.startsWith("/library/");
}
