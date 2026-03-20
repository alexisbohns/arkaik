import Link from "next/link";
import { Gochi_Hand } from "next/font/google";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { ArkaikLogo } from "@/components/branding/ArkaikLogo";

const gochiHand = Gochi_Hand({
  subsets: ["latin"],
  weight: "400",
});

export default function Home() {

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-background font-sans">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(127,127,127,0.12),transparent_62%)]" />

      <header className="relative flex items-center justify-end px-6 py-4">
        <ThemeToggle />
      </header>

      <main className="relative mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center px-6 pb-14 pt-4">
        <div className="w-full max-w-[540px] text-center">
          <ArkaikLogo className="mx-auto" />

          <p className={`${gochiHand.className} mt-3 text-[44px] leading-none text-primary sm:text-[52px]`}>
            for product architects
          </p>

          <Button asChild size="lg" className="mt-10 px-8 text-base">
            <Link href="/projects">Start building</Link>
          </Button>
        </div>
      </main>

      <footer className="relative px-6 pb-6 text-right text-sm text-muted-foreground">
        with love by <a className="underline underline-offset-4" href="https://github.com/alexisbohns" target="_blank" rel="noreferrer">@alexisbohns</a>
      </footer>
    </div>
  );
}
