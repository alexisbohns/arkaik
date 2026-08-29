import type { MaturityLevel } from "@arkaik/schema";
import { cn } from "@/lib/utils";

/**
 * A 0–4 maturity level as a four-segment meter beside its number.
 *
 * `role="img"` rather than a bare `<span>` carrying an `aria-label`: a span maps
 * to `generic`, which prohibits an accessible name, so the label was inert and
 * the row read out as "L2". As an image the whole meter announces the sentence
 * and its own contents go presentational, which is exactly right — the segments
 * are the number drawn twice.
 */
export function LevelMeter({ level }: { level: MaturityLevel }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5" role="img" aria-label={`Level ${level} of 4`}>
      <span className="font-mono text-[10px] text-muted-foreground">L{level}</span>
      <span className="flex gap-0.5" aria-hidden="true">
        {[1, 2, 3, 4].map((step) => (
          <span
            key={step}
            className={cn("h-1.5 w-3 rounded-full", step <= level ? "bg-foreground/70" : "bg-muted")}
          />
        ))}
      </span>
    </span>
  );
}
