"use client";

import { useState, type ReactNode } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";

import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { SPECIES } from "@/lib/config/species";
import { SPECIES_GRAPH_ICONS } from "@/lib/config/species-icons";
import type { Node } from "@/lib/data/types";
import { iconChipVariants } from "@/components/layout/IconChip";
import { useCopyId } from "@/lib/hooks/useCopyId";
import { cn } from "@/lib/utils";

/** Long enough that a pointer crossing a list of chips does not strobe them open. */
const HOVER_CARD_OPEN_DELAY_MS = 250;

interface EntityChipProps {
  node: Node;
  className?: string;
}

/**
 * One entity, as a glyph that tells you three things in one 20px square.
 *
 * At rest it is the species icon, so a list of cross-references reads as a list
 * of *kinds* — a flow, two views, a data model — without a word of chrome. Under
 * the pointer it becomes the copy glyph, which is the affordance: this thing is
 * copyable. After a click it is a check, for as long as it takes to notice.
 *
 * What it copies is the **id alone**, never the title — it is meant for pasting
 * into a commit message, a Lab Note's `nodes:`, or the agent skill, and a
 * clipboard carrying `V-projects — /projects` is useful in none of them. The
 * hover card is where the title lives, because that is a thing to read rather
 * than a thing to paste.
 *
 * The hover card is the chip's own — it opens on the chip, never on the row
 * around it. A row-wide trigger was tried and is genuinely worse: a card fires
 * under the pointer on the way to anything else in the list, covering the rows
 * you were aiming for. Hovering a chip is a deliberate gesture; hovering a row
 * is just passing through.
 *
 * It is a `<button>`, so a row that also navigates must not itself be one —
 * nesting them is invalid HTML and the inner click would never reach the chip.
 * {@link EntityRow} is that pairing, and every list in a panel uses it.
 */
export function EntityChip({ node, className }: EntityChipProps) {
  const [chipActive, setChipActive] = useState(false);
  const { copied, copy } = useCopyId(node.id);

  const speciesConfig = SPECIES.find((candidate) => candidate.id === node.species);
  const speciesLabel = speciesConfig?.label ?? node.species;
  const SpeciesIcon = SPECIES_GRAPH_ICONS[node.species];
  // Copied outranks hovered: the confirmation is the answer to the gesture the
  // reader just made, and their pointer is still on the chip that made it.
  // `CopyIcon`, the glyph this repo already uses for "copy this" (`TokenManager`,
  // `PromptOutput`) — and, unlike a clipboard, one no species glyph looks like.
  // An acceptance's own icon IS a clipboard, so a clipboard hover state made the
  // swap invisible on exactly the rows that carry it most.
  const Icon = copied ? CheckIcon : chipActive ? CopyIcon : SpeciesIcon;

  return (
    // Uncontrolled: Radix opens this on the trigger's own hover AND focus, which
    // is exactly the scope the card wants now that the row is not a trigger.
    // `closeDelay={0}` because the card is text — there is nothing in it to move
    // the pointer into, and a lingering card covers the next row down.
    <HoverCard openDelay={HOVER_CARD_OPEN_DELAY_MS} closeDelay={0}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          // The id, spelled out: the hover card is visual-only, so this label is
          // the only place a screen reader hears what the chip copies.
          aria-label={`Copy ${node.id}`}
          onClick={copy}
          // Tracked here rather than left to `:hover` because the swap must also
          // happen on keyboard focus, and must NOT undo itself while `copied`.
          onPointerEnter={() => setChipActive(true)}
          onPointerLeave={() => setChipActive(false)}
          onFocus={() => setChipActive(true)}
          onBlur={() => setChipActive(false)}
          className={cn(
            iconChipVariants({ size: "sm", variant: "outline", interactive: true }),
            "hover:bg-muted hover:text-foreground",
            copied && "text-green-500",
            className,
          )}
        >
          <Icon />
        </button>
      </HoverCardTrigger>
      <HoverCardContent className="w-72 p-3" side="top" align="start">
        <div className="flex flex-col gap-1.5">
          {/* The whole title, never truncated — the row above it is doing the
              truncating, and this card exists to undo that. */}
          <p className="text-sm font-medium text-foreground">{node.title}</p>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <SpeciesIcon className="size-3.5 shrink-0" />
            <span>{speciesLabel}</span>
          </div>
          <span className="font-mono text-xs break-all text-muted-foreground">{node.id}</span>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

interface EntityRowProps {
  node: Node;
  /** Opens this entity's panel. Omitted on a read-only list; the chip still copies. */
  onOpen?: () => void;
  /** The row's own content, right of the chip. */
  children: ReactNode;
  className?: string;
}

/**
 * The cross-reference row every panel list is made of: an {@link EntityChip},
 * then whatever that list has to say about the entity.
 *
 * A `<div>` wrapping two controls rather than one `<button>`, because the chip
 * is a button and nesting buttons is invalid HTML — the outer one would swallow
 * the chip's click. The hover fill therefore lives on the wrapper, so the row
 * still highlights as one thing, and the two targets divide cleanly: the chip
 * copies the id, everything else opens the entity.
 *
 * It holds no state of its own: the hover card belongs to the chip and opens on
 * the chip alone, so the row is pure layout.
 */
export function EntityRow({ node, onOpen, children, className }: EntityRowProps) {
  return (
    <div
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm",
        onOpen && "transition-colors hover:bg-muted",
        className,
      )}
    >
      <EntityChip node={node} />
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left outline-none focus-visible:underline"
        >
          {children}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
      )}
    </div>
  );
}
