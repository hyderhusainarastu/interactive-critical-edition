import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { accounts, db, sessions, users, verificationTokens } from "@ice/db";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { redirect } from "next/navigation";
import { z } from "zod";

const credentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
});

class EmailNotVerifiedError extends CredentialsSignin {
  code = "email-not-verified";
}

class InvalidCredentialsError extends CredentialsSignin {
  code = "invalid-credentials";
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  // The adapter manages account/session/verification-token records for
  // future OAuth providers (plan §14); the Credentials provider below
  // does its own user lookup in `authorize` rather than going through it.
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  // Required by the Credentials provider — Auth.js only auto-wires
  // database sessions for OAuth-adapter flows. Revocability is instead
  // handled via `users.sessionVersion`, checked below. See CLAUDE.md
  // "Known Problems" for the full rationale (deviation from plan §14).
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) throw new InvalidCredentialsError();
        const { email, password } = parsed.data;

        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.email, email.toLowerCase()))
          .limit(1);

        if (!user || !user.passwordHash) throw new InvalidCredentialsError();
        if (!user.emailVerified) throw new EmailNotVerifiedError();

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) throw new InvalidCredentialsError();

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          sessionVersion: user.sessionVersion,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.uid = user.id;
        token.sessionVersion = (user as { sessionVersion: number }).sessionVersion;
        return token;
      }

      if (typeof token.uid !== "string") return null;

      const [current] = await db
        .select({ sessionVersion: users.sessionVersion })
        .from(users)
        .where(eq(users.id, token.uid))
        .limit(1);

      if (!current || current.sessionVersion !== token.sessionVersion) {
        return null;
      }

      return token;
    },
    async session({ session, token }) {
      if (typeof token.uid === "string") {
        session.user.id = token.uid;
      }
      return session;
    },
  },
});

/**
 * `auth()` returns `Session | null`, and `Session["user"]["id"]` — despite
 * the module augmentation in auth.d.ts — was still inferred as possibly
 * `undefined` at several call sites for reasons that weren't worth fully
 * chasing down (an isolated same-expression probe typechecked fine; real
 * page components didn't). Centralizing one non-null assertion here,
 * backed by a real runtime check, is more robust than relying on the
 * augmentation at every call site.
 */
export async function requireSession() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }
  return session as typeof session & { user: { id: string } };
}

/** Same narrowing as requireSession(), for API routes — returns null instead of redirecting, so the caller can respond with a 401. */
export async function getApiUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}
