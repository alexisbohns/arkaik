/**
 * The full-surface loading placeholder, duplicated verbatim in all ten project
 * pages before this existed — only the noun differed (audit `factorization-7`).
 *
 * Small on purpose, and worth extracting anyway: every idea anyone has ever had
 * about this state — a skeleton, a spinner, keeping the `PageShell` header
 * mounted so the page does not blink its chrome away and back — is a ten-file
 * edit while the block lives at each page's early return, and a one-file edit
 * here.
 *
 * `label` is the bare noun ("library", "delivery board", "map"); the sentence
 * around it belongs to this component so the ten pages cannot punctuate it ten
 * ways.
 */
export function PageLoading({ label }: { label: string }) {
  return (
    <div className="h-full w-full flex items-center justify-center">
      <span className="text-muted-foreground text-sm">Loading {label}...</span>
    </div>
  );
}
