"use client";

import { CheckIcon, CopyIcon, HashIcon } from "lucide-react";

import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { iconChipVariants } from "@/components/layout/IconChip";
import { useCopyId } from "@/lib/hooks/useCopyId";
import { cn } from "@/lib/utils";
import { SPECIES_GRAPH_ICONS } from "@/lib/config/species-icons";
import type { SpeciesId } from "@/lib/config/species";

interface SpeciesBadgeProps {
  species: SpeciesId;
  label: string;
  description?: string;
  showLabel?: boolean;
  onClick?: (e: React.MouseEvent) => void;
}

export function SpeciesBadge({ species, label, description, showLabel = false, onClick }: SpeciesBadgeProps) {
  const SpeciesIcon = SPECIES_GRAPH_ICONS[species];

  return (
    <HoverCard openDelay={250}>
      <HoverCardTrigger asChild>
        <abbr
          tabIndex={0}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted/60 shrink-0 no-underline cursor-help"
          aria-label={`About ${label}`}
          onClick={onClick}
        >
          <SpeciesIcon className="size-3.5" />
          {showLabel && <span>{label}</span>}
        </abbr>
      </HoverCardTrigger>
      <HoverCardContent className="w-64 p-3" align="start">
        <div className="flex items-start gap-2">
          <SpeciesIcon className="mt-0.5 size-4 text-muted-foreground" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">{label}</p>
            <p className="text-xs text-muted-foreground">
              {description ?? "No species description available."}
            </p>
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

interface EntityIdProps {
  id: string;
}

const ENTITY_ID_CLASS =
  "rounded bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground";

export function EntityId({ id }: EntityIdProps) {
  return <span className={ENTITY_ID_CLASS}>{id}</span>;
}

interface CopyIdChipProps {
  id: string;
  className?: string;
}

/**
 * The glyph both copy affordances wear: a hash that becomes a copy mark under
 * the pointer, and a tick once the id is on the clipboard.
 *
 * The hash is the resting state because it is a *label* — "there is an id
 * here" — and the copy mark is the *affordance*, which only needs to exist
 * once you are pointing at the thing. Showing the copy mark all the time would
 * label every id in the app as a button; showing nothing until hover leaves a
 * gap that fills in under the pointer, which is what this replaced.
 *
 * Both are stacked in one fixed-size box rather than swapped by a state
 * variable, so the exchange is pure CSS on the parent's `group` — no hover
 * state in React, no reflow, and `group-focus-visible` gets it for free on a
 * keyboard. The tick is the one real branch: it is the only state the DOM
 * cannot infer from the pointer.
 */
function CopyIdGlyph({ copied }: { copied: boolean }) {
  if (copied) return <CheckIcon className="size-3 shrink-0" aria-hidden="true" />;

  return (
    <span className="relative inline-flex size-3 shrink-0 items-center justify-center" aria-hidden="true">
      <HashIcon className="absolute size-3 transition-opacity group-hover:opacity-0 group-focus-visible:opacity-0" />
      <CopyIcon className="absolute size-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
    </span>
  );
}

/**
 * A hash in a box that puts an entity id on the clipboard.
 *
 * "There is an id here", one tap from being pastable — into a commit message, a
 * Lab Note's `nodes:`, the agent skill. It copies the **id alone**, never the
 * title, for the same reason {@link EntityChip} does: a clipboard carrying
 * `V-projects — /projects` is useful nowhere it would be pasted.
 *
 * Deliberately a hash rather than the species glyph {@link EntityChip} wears.
 * This one is used where the species is already said elsewhere on the row — a
 * panel header carrying a species badge, a playlist row carrying its platform
 * marks — so a second species glyph would be a word repeated, and the hash says
 * the one thing that is not otherwise on screen.
 */
export function CopyIdChip({ id, className }: CopyIdChipProps) {
  const { copied, copy } = useCopyId(id);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          // The id, spelled out: the tooltip is visual-only, so this label is
          // the only place a screen reader hears what the chip copies — and
          // where the id is not written out, the only place it exists at all.
          aria-label={`Copy ${id}`}
          onClick={copy}
          className={cn(
            iconChipVariants({ size: "sm", variant: "outline", interactive: true }),
            "group hover:bg-muted hover:text-foreground",
            copied && "text-green-500",
            className,
          )}
        >
          <CopyIdGlyph copied={copied} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <span className="font-mono">{id}</span>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * The id spelled out, and copyable by clicking it.
 *
 * The wide half of {@link PanelHeaderEntityId}. It was a plain `<span>`, which
 * made the panel header the one place an id was legible but not pastable — you
 * could copy it by tapping the hash on a narrow window, and had to select it by
 * hand on a wide one, which is backwards.
 *
 * The glyph leads, and is {@link CopyIdGlyph} — the same hash the narrow
 * variant wears, so one id does not announce itself two ways at two widths. It
 * sat trailing and invisible-until-hover first, which left a hole on the right
 * of every id that filled in under the pointer; a slot that is always occupied
 * and merely changes glyph has no such moment.
 *
 * The whole chip is the button, not the glyph: a 12px target inside a row you
 * are already pointing at is a worse version of the same gesture.
 */
function CopyIdText({ id, className }: CopyIdChipProps) {
  const { copied, copy } = useCopyId(id);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          // Spelled out for the reason `CopyIdChip`'s is: the tooltip is
          // visual-only, so this is the only place a screen reader is told the
          // chip copies rather than navigates.
          aria-label={`Copy ${id}`}
          onClick={copy}
          className={cn(
            ENTITY_ID_CLASS,
            "group inline-flex cursor-pointer items-center gap-1 outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50",
            copied && "text-green-600 dark:text-green-400",
            className,
          )}
        >
          <CopyIdGlyph copied={copied} />
          {id}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{copied ? "Copied" : "Copy id"}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The entity id in a **panel header**: the id spelled out at `lg` and up, a
 * {@link CopyIdChip} below it. **Copyable either way** — see {@link CopyIdText}
 * for why the wide one had to stop being a plain span.
 *
 * A panel header is one row that has to hold a species badge, an id and a close
 * button, and below `lg` a panel is at most half the window and often all of it.
 * There, a full `AC-sections-mirror-project-homes` either pushes the badge off
 * the row or truncates into a stub that is neither readable nor copyable. So it
 * collapses to a hash — "there is an id here" — that puts the whole thing on the
 * clipboard in one tap, which is what a narrow screen wants from an id anyway.
 *
 * Both renditions are in the DOM with a breakpoint deciding which shows, rather
 * than a `useIsMobile` branch: the header is server-rendered, and a hook-based
 * switch would hydrate the wrong one for a frame on every panel open.
 */
export function PanelHeaderEntityId({ id }: EntityIdProps) {
  return (
    <>
      <CopyIdText id={id} className="hidden lg:inline-flex" />
      <CopyIdChip id={id} className="lg:hidden" />
    </>
  );
}
