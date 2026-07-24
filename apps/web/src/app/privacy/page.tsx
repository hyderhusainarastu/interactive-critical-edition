import type { Metadata } from "next";
import { PolicyPageLayout, type PolicySection } from "@/components/site/PolicyPageLayout";
import { SITE_NAME } from "@/lib/brand";
import "../site-theme.css";

export const metadata: Metadata = {
  title: `Privacy & Copyright — ${SITE_NAME}`,
  description: "How your data, uploads, research choices, and system-generated content are handled.",
};

const sections: PolicySection[] = [
  {
    id: "what-we-store",
    title: "What we store",
    content: (
      <p>
        We store your account details; the works you upload and text extracted from them; highlights, notes,
        bookmarks, reading status, understanding ratings, corrections, and conversations; and preferences such as
        reader level. Passwords are stored only as secure hashes. Uploaded files remain isolated to your account.
      </p>
    ),
  },
  {
    id: "research-sharing",
    title: "Research data sharing is your choice",
    content: (
      <>
        <p>
          You can explicitly opt in to share activity with the Palimnote team for research concerning pedagogy and
          research practices. The option is off by default. If you opt in, the research view may include the titles
          of works you upload, activity and usage patterns, and your reading-companion conversation histories.
        </p>
        <p>
          You can revoke permission at any time from your profile. Turning it off stops future content-level research
          access. Your account continues to work whether you share or not.
        </p>
      </>
    ),
  },
  {
    id: "telemetry",
    title: "Service analytics and page visits",
    content: (
      <p>
        We record content-free service events such as page-visit counts, session starts, uploads, chat-message counts,
        and feedback submissions. These records help us understand reliability and how the beta is used. Page paths
        and timestamps are retained; page contents, note text, and message text are not copied into these event
        records.
      </p>
    ),
  },
  {
    id: "isolation",
    title: "Your data is isolated to you",
    content: (
      <p>
        Every private resource is scoped to your account. Requests for a resource you do not own return
        &ldquo;not found&rdquo; rather than revealing that it exists. Content-level research access is also withheld
        from the Palimnote research view unless you have opted in.
      </p>
    ),
  },
  {
    id: "copyright",
    title: "Copyright — you bring your own texts",
    content: (
      <p>
        Palimnote never bypasses paywalls or obtains copyrighted material on your behalf. For works it cannot obtain,
        it stores a citation and a pointer toward legitimate acquisition. Upload only a copy you are permitted to use.
        Roadmaps can still represent an unavailable work, clearly marked as not directly inspected.
      </p>
    ),
  },
  {
    id: "automated-processing",
    title: "Automated classification",
    content: (
      <p>
        Bibliographic facts come from real catalogue lookups rather than generated citations. When a model classifies
        how a reference relates to a passage, the request goes to the configured provider under its data-use terms.
        Uploaded content is never used to train models without a separate, explicit opt-in.
      </p>
    ),
  },
  {
    id: "deletion",
    title: "Account deletion and export",
    content: (
      <>
        <p>
          You may delete your account at any time. Deletion removes your uploaded files, extracted text, annotations,
          notes, conversations, and derived workspace data — not just your sign-in record. You may also export your
          notes, roadmap, and bibliography.
        </p>
        <p>
          We may retain a content-free aggregate record after deletion so platform totals remain accurate, such as
          when the account was created and deleted and aggregate document or activity counts. It does not preserve
          uploaded text, notes, or conversation transcripts.
        </p>
      </>
    ),
  },
  {
    id: "feedback",
    title: "Feedback",
    content: (
      <p>
        Feedback you submit is delivered to the Palimnote team with its category, message, the page it came from, and
        — when you provide one — your account or contact email. We use it to investigate bugs and improve the product.
        Feedback is not published or used as research content without asking you.
      </p>
    ),
  },
  {
    id: "scholarly-limits",
    title: "A research aid, not settled scholarship",
    content: (
      <p>
        System-generated claims carry confidence and provenance, explaining the basis for the inference rather than
        presenting it as settled fact. Verify against the primary text before relying on anything; you can correct,
        dispute, or hide an automated annotation.
      </p>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <PolicyPageLayout
      eyebrow="Privacy / Copyright / Research"
      title="Privacy & copyright"
      summary="A plain-language account of what Palimnote stores, what stays private, and the research choices that remain yours."
      sections={sections}
    />
  );
}
