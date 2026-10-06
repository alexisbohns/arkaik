import type { Metadata } from "next";
import Link from "next/link";

import { ArkaikLogo } from "@/components/branding/ArkaikLogo";
import { ThemeToggle } from "@/components/theme-toggle";
import { signInFailure, type SignInFailure } from "@/lib/services/auth-errors";
import { databaseReachable, servicesConfigured } from "@/lib/services/db";

/**
 * /auth/error — where Auth.js sends a failed sign-in (`pages.error` in auth.ts).
 *
 * Replaces the built-in page, which says "There is a problem with the server
 * configuration" for every `error=Configuration` — including the adapter write
 * failing because the database is down (issue #491). That code is ambiguous by
 * design (Auth.js keeps adapter errors off the client), so this page probes the
 * database itself, and only for that code, before choosing what to say.
 *
 * It MUST NOT require a session: Auth.js detects an error page that redirects
 * back into auth and falls back to its own.
 */
export const metadata: Metadata = {
  title: "Sign-in problem · arkaik",
  robots: { index: false },
};

const COPY: Record<SignInFailure, { title: string; body: string }> = {
  database: {
    title: "Sign-in is temporarily unavailable",
    body:
      "We can't reach our database right now, so we can't sign you in. Nothing is wrong with your " +
      "account, and projects kept in this browser still work. Try again in a few minutes.",
  },
  configuration: {
    title: "Sign-in isn't set up correctly",
    body:
      "This deployment is missing part of its sign-in setup. If you run it, the server logs name " +
      "what's wrong.",
  },
  denied: {
    title: "Sign-in was declined",
    body: "GitHub didn't let this sign-in through. If that wasn't on purpose, try again.",
  },
  other: {
    title: "Sign-in didn't work",
    body: "Something went wrong on the way back from GitHub. Try again in a moment.",
  },
};

export default async function SignInErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const { error } = await searchParams;
  const type = Array.isArray(error) ? error[0] : error;
  // No DATABASE_URL at all is a configuration problem, not an outage.
  const databaseUp =
    type === "Configuration" && servicesConfigured() ? await databaseReachable() : null;
  const copy = COPY[signInFailure(type, databaseUp)];

  return (
    <div className="flex min-h-svh flex-col bg-background font-sans">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <Link href="/" aria-label="Go to arkaik home" className="inline-flex items-center">
          <ArkaikLogo className="w-20 shrink-0" />
        </Link>
        <ThemeToggle />
      </header>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <h1 className="text-lg font-semibold">{copy.title}</h1>
        <p className="text-sm text-muted-foreground">{copy.body}</p>
        <Link href="/" className="text-sm underline underline-offset-4">
          Back to arkaik
        </Link>
      </main>
    </div>
  );
}
