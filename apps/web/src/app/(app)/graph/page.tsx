import { GraphView } from "@/components/graph/GraphView";
import { requireSession } from "@/lib/auth";

export default async function GlobalGraphPage() {
  await requireSession();
  return <GraphView endpoint="/api/graph" backHref="/dashboard" backLabel="Library" />;
}
