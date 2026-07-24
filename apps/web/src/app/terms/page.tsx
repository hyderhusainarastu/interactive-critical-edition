import type { Metadata } from "next";
import { PolicyPageLayout, type PolicySection } from "@/components/site/PolicyPageLayout";
import { SITE_NAME } from "@/lib/brand";
import "../site-theme.css";

export const metadata: Metadata = {
  title: `Terms — ${SITE_NAME}`,
  description: `The terms of use for the ${SITE_NAME} reader.`,
};

const sections: PolicySection[] = [
  {
    id: "research-aid",
    title: "A research aid, not a source of truth",
    content: (
      <p>
        Palimnote produces automated annotations, relationship classifications, and reading roadmaps to support your
        own reading and judgment. They are not authoritative scholarship or a substitute for primary sources.
        Accuracy is not guaranteed; inspect the evidence and verify material claims.
      </p>
    ),
  },
  {
    id: "lawful-uploads",
    title: "Upload only what you may",
    content: (
      <p>
        Upload only texts you have the legal right to use: works you own, have licensed, or that are in the public
        domain. Do not use the service to distribute copyrighted material or circumvent access controls.
      </p>
    ),
  },
  {
    id: "account",
    title: "Your account",
    content: (
      <p>
        Keep your credentials secure; you are responsible for activity under your account. You may delete your
        account and its content at any time. Your use of the service is also subject to the Privacy &amp; Copyright
        notice, including its explanation of optional research sharing and content-free service analytics.
      </p>
    ),
  },
  {
    id: "conversations",
    title: "Reading-companion conversations",
    content: (
      <p>
        Conversations help Palimnote gauge your familiarity with topics so explanations and reading routes can meet
        your current level. Conversation content remains private unless you explicitly opt in to research data
        sharing. You can withdraw that permission from your profile at any time.
      </p>
    ),
  },
  {
    id: "feedback",
    title: "Feedback you send",
    content: (
      <p>
        When you submit feedback, you permit the Palimnote team to review it for support, debugging, and product
        improvement. Do not include confidential information you do not want the team to read.
      </p>
    ),
  },
  {
    id: "availability",
    title: "Availability",
    content: (
      <p>
        The beta is provided as-is, without warranty. Features and availability may change as the service develops.
        We may suspend access needed to protect readers, data, or service reliability.
      </p>
    ),
  },
];

export default function TermsPage() {
  return (
    <PolicyPageLayout
      eyebrow="Terms / Beta"
      title="Terms of use"
      summary="The compact agreement behind using Palimnote as a careful reading and research workspace."
      sections={sections}
    />
  );
}
