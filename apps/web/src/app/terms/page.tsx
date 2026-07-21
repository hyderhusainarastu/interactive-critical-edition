import type { Metadata } from "next";
import { SiteFooter } from "@/components/site/SiteFooter";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SITE_NAME } from "@/lib/brand";

export const metadata: Metadata = {
  title: `Terms — ${SITE_NAME}`,
  description: `The terms of use for the ${SITE_NAME} reader.`,
};

export default function TermsPage() {
  return (
    <div className="flex min-h-full flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-12">
        <h1 className="font-serif text-3xl font-semibold text-[var(--color-text)]">Terms of use</h1>
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">
          A plain-language summary of how you may use the service.
        </p>

        <div className="mt-8 flex flex-col gap-6 text-[var(--color-text)]">
          <Section title="A research aid, not a source of truth">
            The service generates AI-assisted annotations, relationship classifications, and reading roadmaps to help
            you understand difficult texts. These are aids for your own reading and judgment — not authoritative
            scholarship, and not a substitute for the primary sources. Accuracy is not guaranteed; always verify.
          </Section>

          <Section title="Upload only what you may">
            Upload only texts you have the legal right to use (works you own, have licensed, or that are in the public
            domain). Don&rsquo;t use the service to distribute copyrighted material or to circumvent access controls.
          </Section>

          <Section title="Your account">
            Keep your credentials secure; you&rsquo;re responsible for activity under your account. You may delete your
            account and its data at any time.
          </Section>

          <Section title="Availability">
            The service is provided as-is, without warranty. Features and availability may change as it develops.
          </Section>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="font-serif text-lg font-semibold text-[var(--color-text)]">{title}</h2>
      <p className="mt-1 leading-relaxed text-[var(--color-text-muted)]">{children}</p>
    </section>
  );
}
