import { PageHeader } from "@/components/app/PageHeader";
import { AccountTabs } from "./AccountTabs";

/**
 * Workstream G (v.5): tab nav shared by /account/profile, /account/usage,
 * and /account/plan. Auth is already enforced one level up by
 * `(app)/layout.tsx`'s `requireSession()` — every route under `(app)`
 * inherits it, so this layout adds no auth check of its own (see
 * `security.spec.ts`'s `/account` redirect probes, which exercise that
 * inherited behavior rather than anything new here).
 */
export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-12">
      <PageHeader eyebrow="Account" title="Your account" description="Profile, usage, and plan." />
      <AccountTabs />
      {children}
    </div>
  );
}
