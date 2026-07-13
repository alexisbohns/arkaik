import Link from "next/link";
import { ArkaikLogo } from "@/components/branding/ArkaikLogo";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * 404 state for `/p/{id}` when the snapshot id does not exist (docs/spec/services.md
 * § Publik → Surfaces: "404 state for missing ids"). Triggered by `notFound()`
 * in `app/p/[id]/page.tsx` — a missing/removed id and a malformed one both land
 * here, since Publik reads are by unguessable id only (no listing endpoint to
 * distinguish "never existed" from "removed").
 */
export default function PublikSnapshotNotFound() {
  return (
    <div className="flex min-h-svh flex-col bg-background font-sans">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <Link href="/" aria-label="Go to arkaik home" className="inline-flex items-center">
          <ArkaikLogo className="w-20 shrink-0" />
        </Link>
        <ThemeToggle />
      </header>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <h1 className="text-lg font-semibold">Snapshot not found</h1>
        <p className="text-sm text-muted-foreground">
          This link doesn&apos;t point to a snapshot we have — it may have been removed, or the URL may be
          incorrect. Publik snapshots carry no retention guarantee.
        </p>
        <Link href="/" className="text-sm underline underline-offset-4">
          Back to arkaik
        </Link>
      </main>
    </div>
  );
}
