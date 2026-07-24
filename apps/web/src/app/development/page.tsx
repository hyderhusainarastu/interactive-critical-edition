import type { Metadata } from "next";
import { DevelopmentTimeline } from "@/components/site/DevelopmentTimeline";
import { SiteFooter } from "@/components/site/SiteFooter";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SITE_NAME } from "@/lib/brand";
import "../site-theme.css";
import "./development.css";

export const metadata: Metadata = {
  title: `Palimnote Development — ${SITE_NAME}`,
  description:
    "A public record of how Palimnote’s scholarly reading workspace has developed.",
};

export default function DevelopmentPage() {
  return (
    <div className="pal-site development-page flex min-h-full flex-col">
      <SiteHeader />
      <main className="development-main">
        <header className="development-hero">
          <p className="development-kicker">Palimnote Development</p>
          <h1>A reader built in layers.</h1>
          <p>
            Palimnote develops the way a critical edition does: through
            accumulated readings, revisions, and clearer connections back to
            the source. This page records the public shape of that work.
          </p>
          <div className="development-rule" aria-hidden="true">
            <span>§</span>
          </div>
        </header>
        <DevelopmentTimeline />
      </main>
      <SiteFooter />
    </div>
  );
}
