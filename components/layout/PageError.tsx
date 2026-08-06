"use client";

import { RotateCwIcon, TriangleAlertIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The full-surface "this did not load" state — `PageLoading`'s counterpart, and
 * the whole point of audit `quality-frontend-2` (#362): the four data hooks
 * caught their load failures and no surface ever read the `error`, so a failed
 * read rendered as "No views yet. Create one to get started." — an invitation
 * to recreate, by hand, nodes that are sitting safe in a store we simply could
 * not reach.
 *
 * **Deliberately NOT built on `EmptyState`.** The dashed card is the vocabulary
 * of "there is nothing here yet", and the bug being fixed is precisely that a
 * failure was indistinguishable from that. Reusing the same card would leave
 * the two states differing only in the sentence inside them, so the reader
 * would still have to *read* to learn whether their work is gone. A solid,
 * destructive-tinted card answers that before a word is read.
 *
 * `label` is the same bare noun `PageLoading` takes ("library", "delivery
 * board", "graph"); the sentence around it belongs to this component so twelve
 * surfaces cannot punctuate it twelve ways. `message` is the hook's own error
 * string — the provider's message for a remote failure, which is what lets a
 * 401 ("sign in again") read differently from a 500.
 */
interface PageErrorProps {
  /** The bare noun of what failed, as `PageLoading` takes it. */
  label: string;
  /** The hook's `error` string. Omitted when there is nothing more to say. */
  message?: string | null;
  /** Re-runs the load(s) this surface needs. Omit only if nothing can retry. */
  onRetry?: () => void;
  /** For a surface that is not the whole page — `flex-1` inside a column. */
  className?: string;
}

export function PageError({ label, message, onRetry, className }: PageErrorProps) {
  return (
    <div className={cn("h-full w-full flex items-center justify-center p-6", className)}>
      {/* `role="alert"` because this mounts in place of the content the reader
          asked for: it is an interruption, not a status line they may notice. */}
      <div
        role="alert"
        className="flex max-w-md flex-col items-center gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-6 text-center"
      >
        <TriangleAlertIcon className="size-5 text-destructive" aria-hidden="true" />
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">Couldn&rsquo;t load the {label}.</p>
          {/* Says what is NOT true, because the fear this state has to answer is
              "did I just lose everything?" — the answer is no, and nothing here
              should be recreated by hand. */}
          <p className="text-sm text-muted-foreground">
            Nothing was lost — a read failed, so there is nothing here to show.
          </p>
          {message && <p className="text-xs text-muted-foreground">{message}</p>}
        </div>
        {onRetry && (
          <Button size="sm" variant="outline" className="cursor-pointer" onClick={onRetry}>
            <RotateCwIcon className="size-4" />
            Try again
          </Button>
        )}
      </div>
    </div>
  );
}
