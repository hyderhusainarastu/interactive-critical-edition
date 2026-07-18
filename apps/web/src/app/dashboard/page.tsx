import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { logoutAction } from "@/lib/actions";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 px-6 py-24">
      <p className="text-sm text-[var(--color-text-muted)]">
        Signed in as {session.user.email}
      </p>
      <h1 className="text-3xl font-semibold text-[var(--color-text)]">
        Dashboard
      </h1>
      <p className="text-[var(--color-text-muted)]">
        Library, uploads, and workspaces land in Phase 2. This page confirms
        auth is wired end to end.
      </p>
      <form action={logoutAction}>
        <button
          type="submit"
          className="w-fit rounded-md border border-[var(--color-border)] px-4 py-2 text-[var(--color-text)]"
        >
          Log out
        </button>
      </form>
    </main>
  );
}
