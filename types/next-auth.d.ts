import type { DefaultSession } from "next-auth";

/**
 * Module augmentation so `session.user.id` is typed across the app. The value is
 * populated by the `session` callback in auth.ts (from the JWT `sub`). Route
 * handlers and client components rely on it to scope Synk data by owner.
 */
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}
