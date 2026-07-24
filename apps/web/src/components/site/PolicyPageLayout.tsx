import type { ReactNode } from "react";
import { PublicExperience } from "@/components/site/PublicExperience";
import { SiteFooter } from "@/components/site/SiteFooter";
import { SiteHeader } from "@/components/site/SiteHeader";

export interface PolicySection {
  id: string;
  title: string;
  content: ReactNode;
}

export function PolicyPageLayout({
  eyebrow,
  title,
  summary,
  sections,
}: {
  eyebrow: string;
  title: string;
  summary: string;
  sections: PolicySection[];
}) {
  return (
    <div className="pal-site policy-page">
      <SiteHeader />
      <PublicExperience />
      <main>
        <header className="policy-hero">
          <div>
            <p className="section-index">{eyebrow}</p>
            <h1>{title}</h1>
            <p>{summary}</p>
          </div>
          <span aria-hidden="true">PAL / POLICY</span>
        </header>
        <div className="policy-layout">
          <nav className="policy-toc" aria-label={`${title} sections`}>
            <p>On this page</p>
            {sections.map((section, index) => (
              <a key={section.id} href={`#${section.id}`}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                {section.title}
              </a>
            ))}
          </nav>
          <article className="policy-copy">
            {sections.map((section, index) => (
              <section id={section.id} key={section.id} aria-labelledby={`${section.id}-title`}>
                <p className="policy-number">{String(index + 1).padStart(2, "0")}</p>
                <h2 id={`${section.id}-title`}>{section.title}</h2>
                <div>{section.content}</div>
              </section>
            ))}
          </article>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
