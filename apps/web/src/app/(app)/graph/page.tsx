import { GraphView } from "@/components/graph/GraphView";
import { phase12FeatureEnabled } from "@ice/config";
import { requireSession } from "@/lib/auth";

export default async function GlobalGraphPage() {
  await requireSession();
  return <GraphView endpoint="/api/graph" backHref="/dashboard" backLabel="Library" enableExpansion={phase12FeatureEnabled("crossLibraryGraph")} />;
}
