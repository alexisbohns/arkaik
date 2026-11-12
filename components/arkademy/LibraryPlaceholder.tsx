import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * What a page shows, inside its Suspense boundary, while the library is read:
 * a few quiet bars and one line for screen readers. The read is bounded
 * (ARKADEMY_READ_TIMEOUT_MS in lib/services/arkademy.ts), so it gives way to
 * the content or to `ArkademyMessage` within seconds. No hooks: a server
 * page's `fallback`.
 */
export function LibraryPlaceholder({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <p className="sr-only">Loading the library…</p>
      <Skeleton aria-hidden="true" className="h-4 w-full max-w-xl" />
      <Skeleton aria-hidden="true" className="h-4 w-4/5 max-w-lg" />
      <Skeleton aria-hidden="true" className="h-4 w-3/5 max-w-md" />
    </div>
  );
}
