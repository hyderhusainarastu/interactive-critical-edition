import { db, users } from "@ice/db";
import { eq } from "drizzle-orm";
import { requireSession } from "@/lib/auth";
import { AccountProfileForm } from "./AccountProfileForm";
import { DataSharingToggle } from "./DataSharingToggle";
import { DeleteAccountSection } from "./DeleteAccountSection";

export default async function AccountProfilePage() {
  const session = await requireSession();
  const [me] = await db
    .select({ id: users.id, name: users.name, email: users.email, image: users.image, dataSharingEnabled: users.dataSharingEnabled })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  if (!me) {
    // The session's own jwt callback already re-checks this on every
    // request (see `apps/web/src/lib/auth.ts`) — a gone-but-still-sessioned
    // user is a narrow race, not a state this page needs a bespoke UI for.
    return null;
  }

  return (
    <div className="flex flex-col gap-8">
      <AccountProfileForm userId={me.id} name={me.name} email={me.email} image={me.image} />
      <DataSharingToggle initialEnabled={me.dataSharingEnabled} />
      <DeleteAccountSection email={me.email} />
    </div>
  );
}
