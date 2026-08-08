import type { PlatformId } from "@/lib/config/platforms";
import type { StatusId } from "@/lib/config/statuses";
import { cn } from "@/lib/utils";
import {
  PLATFORM_ICONS,
  PLATFORM_LABELS,
  STATUS_ICONS,
  STATUS_LABELS,
  STATUS_STYLES,
} from "./node-styles";

interface StatusMarkProps {
  /**
   * The platform this mark speaks for, or `null` when availability is not a
   * tracked dimension — a scope on one platform or none (a CLI, a public API).
   */
  platform: PlatformId | null;
  /** The resolved status. `undefined` means not applicable on this platform. */
  status: StatusId | undefined;
  className?: string;
}

/**
 * One glyph carrying two facts: **which platform** by its shape, **what status**
 * by its colour.
 *
 * This is the compact form of what `PlatformList` spells out over two lines and a
 * label. A row listing three or four of these reads as one availability strip —
 * "web is live, iOS is in development, Android is not applicable" — in the space
 * a single word would take, which is what lets a list of acceptances show its
 * statuses without a column per platform and a header to name them.
 *
 * With no platform to speak for it falls back to the status's own icon, so the
 * colour still lands on a shape that means something rather than on a bare dot.
 * The two cases are deliberately the same size and the same weight: a
 * single-platform product should look like a simpler version of a
 * multi-platform one, not like a different control.
 *
 * Colour is never the only channel. The status is always in the `aria-label` and
 * the `title`, because these seven greens, blues and violets are exactly the
 * distinctions colour-blind readers lose, and a strip of identical grey monitors
 * would otherwise be unreadable.
 */
export function StatusMark({ platform, status, className }: StatusMarkProps) {
  const platformLabel = platform === null ? null : PLATFORM_LABELS[platform];

  if (!status) {
    // An em dash, not a dimmed icon: "not applicable here" and "here but barely
    // started" are different answers, and a faded glyph reads as the second.
    const label = platformLabel === null ? "Not applicable" : `${platformLabel}: not applicable`;
    return (
      <span
        title={label}
        aria-label={label}
        className={cn("inline-flex size-4 items-center justify-center text-muted-foreground/40", className)}
      >
        —
      </span>
    );
  }

  const Icon = platform === null ? STATUS_ICONS[status] : PLATFORM_ICONS[platform];
  const statusLabel = STATUS_LABELS[status];
  const label = platformLabel === null ? statusLabel : `${platformLabel}: ${statusLabel}`;

  return (
    <span title={label} className="inline-flex">
      <Icon className={cn("size-4 shrink-0", STATUS_STYLES[status].badge, className)} aria-label={label} />
    </span>
  );
}
