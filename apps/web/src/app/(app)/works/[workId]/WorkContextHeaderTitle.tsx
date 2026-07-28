"use client";

import { useRegisterContextBar } from "@/components/shell/ContextBarProvider";

/**
 * Registers this work's title with the Stage 1 sticky context bar
 * (`useRegisterContextBar`, spec §0/§3.2) — renders nothing itself. Kept as
 * its own tiny component so the registration effect's lifetime matches
 * exactly the work context layout's own mount/unmount, independent of
 * whatever else `WorkContextHeader` renders.
 */
export function WorkContextHeaderTitle({ title }: { title: string }) {
  useRegisterContextBar({ title });
  return null;
}
