/**
 * next-auth v5's `Session`/`JWT` types are declared in @auth/core and
 * only *re-exported* (`export type { Session } from "@auth/core/types"`)
 * by `next-auth`/`next-auth/jwt`. Augmenting `declare module "next-auth"`
 * creates an unrelated interface that never merges with the real one —
 * `session.user.id` silently stays `string | undefined` with no type
 * error to flag it. The augmentation has to target the declaring module.
 *
 * Declaring the `user` shape directly here (rather than intersecting
 * with `DefaultSession["user"]`) sidesteps a second footgun: the base
 * `Session extends DefaultSession {}` inherits an *optional* `user?`,
 * and merging that with an own required `user:` member via
 * `DefaultSession["user"] & {...}` did not reliably override the
 * optionality at every call site — `session.user.id` stayed
 * `string | undefined` in consuming files even though an isolated
 * probe inside auth.ts itself showed `string`. Not fully explained,
 * not worth more time chasing — this direct-shape form is unambiguous.
 */
declare module "@auth/core/types" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    uid?: string;
    sessionVersion?: number;
  }
}
