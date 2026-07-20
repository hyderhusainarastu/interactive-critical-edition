import { completeOnboardingAction } from "@/lib/actions";
import { requireSession } from "@/lib/auth";

/**
 * Short, optional onboarding (plan §23 Phase 6, levels updated Phase 9.4):
 * asks for a reader level (which seeds the roadmap's default — plan §34.4
 * 9.4's four-level vocabulary) and nudges toward a first upload. Everything
 * here is skippable — it never blocks getting into the product, and picking
 * a level here only changes what opens by DEFAULT, never what's reachable
 * (every level can always see everything via "Show all levels"). The
 * dashboard routes new users here until `onboardedAt` is set.
 */
const LEVELS: { value: string; label: string; blurb: string }[] = [
  { value: "beginner", label: "New to the field", blurb: "Show me the essentials and prerequisites first." },
  { value: "undergraduate", label: "Some background", blurb: "A balanced roadmap with useful context." },
  { value: "advanced", label: "Working researcher", blurb: "Context, comparisons, and the interpretive tail." },
  { value: "research", label: "Specialist in this area", blurb: "The full picture — nothing narrowed by default." },
];

export default async function WelcomePage() {
  const session = await requireSession();
  const firstName = session.user.name?.split(" ")[0];

  return (
    <div className="mx-auto max-w-xl px-6 py-16">
      <h1 className="font-serif text-3xl font-semibold text-[var(--color-text)]">
        Welcome{firstName ? `, ${firstName}` : ""}.
      </h1>
      <p className="mt-3 text-[var(--color-text-muted)]">
        One quick question so your reading roadmaps start out tuned to you — you can change it anytime, or skip.
      </p>

      <form action={completeOnboardingAction} className="mt-8 flex flex-col gap-4">
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-medium text-[var(--color-text)]">
            How deep do you usually read in a new field?
          </legend>
          {LEVELS.map((lvl, i) => (
            <label
              key={lvl.value}
              className="flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 has-[:checked]:border-[var(--color-accent-ink)]"
            >
              <input
                type="radio"
                name="readerLevel"
                value={lvl.value}
                defaultChecked={i === 1}
                className="mt-1"
              />
              <span>
                <span className="block font-medium text-[var(--color-text)]">{lvl.label}</span>
                <span className="block text-sm text-[var(--color-text-muted)]">{lvl.blurb}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            className="rounded-md bg-[var(--color-accent-ink)] px-5 py-2.5 text-sm font-medium text-[var(--color-background)]"
          >
            Upload my first text
          </button>
          <button
            type="submit"
            name="skip"
            value="1"
            className="rounded-md border border-[var(--color-border)] px-5 py-2.5 text-sm text-[var(--color-text)]"
          >
            Skip for now
          </button>
        </div>
      </form>
    </div>
  );
}
