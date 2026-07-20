import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { getUserPreferences } from "@/lib/preferences";
import { TrashView } from "./TrashView";

export default async function TrashPage() {
  const session = await requireSession();
  const prefs = await getUserPreferences(session.user.id);
  if (!prefs.onboardedAt) redirect("/welcome");

  return <TrashView />;
}
