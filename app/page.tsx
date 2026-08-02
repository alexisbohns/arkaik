import Link from "next/link";
import { redirect } from "next/navigation";
import { Gochi_Hand } from "next/font/google";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { ArkaikLogoBoil } from "@/components/branding/ArkaikLogoBoil";
import { AsciiTerrainBackground } from "@/components/background/AsciiTerrainBackground";
import { getSession } from "@/lib/services/auth";

const gochiHand = Gochi_Hand({
  subsets: ["latin"],
  weight: "400",
});

/**
 * `force-dynamic` because the landing page's answer depends on the session
 * cookie. Without it Next would prerender this page at build time, and the
 * dynamic-usage error `getSession()` swallows (it degrades every failure to
 * "no session") would silently bake the signed-out landing page in — the
 * redirect would then never fire for anyone. Deciding per request is the whole
 * point of the check, so the page has to be dynamic explicitly.
 */
export const dynamic = "force-dynamic";

/**
 * The landing page is for people who are not signed in yet. A signed-in visitor
 * has already made the choice this page pitches, so send them straight to their
 * projects instead of making them press "Start building" every time.
 *
 * GRACEFUL ABSENCE (docs/spec/services.md § Backend — env rules): `getSession()`
 * returns null without touching env or Postgres when auth is unconfigured, so
 * the local-first build renders exactly the page it always did.
 */
export default async function Home() {
  const session = await getSession();
  if (session?.user) {
    redirect("/projects");
  }

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-background font-sans">
      <AsciiTerrainBackground />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(127,127,127,0.12),transparent_62%)]" />

      <header className="relative flex items-center justify-end px-6 py-4">
        <ThemeToggle />
      </header>

      <main className="relative mx-auto flex w-full flex-1 flex-col items-center justify-center px-6 pb-14 pt-4">
        <div className="w-full max-w-[400px] text-center">
          <ArkaikLogoBoil className="mx-auto" />

          <p className={`${gochiHand.className} mt-3 text-[32px] leading-none text-primary sm:text-[32px]`}>
            for product architects
          </p>

          <Button asChild size="lg" className="mt-10 px-8 text-base">
            <Link href="/projects">Start building</Link>
          </Button>

          <Link
            href="/docs"
            className="mt-4 block text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            Read the doc
          </Link>
        </div>
      </main>

      <footer className="relative px-6 pb-6 text-right text-sm text-muted-foreground">
        with love by <a className="underline underline-offset-4" href="https://github.com/alexisbohns" target="_blank" rel="noreferrer">@alexisbohns</a>
      </footer>
    </div>
  );
}
