"use client";

import { useCallback, useMemo, useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { SPECIES } from "@/lib/config/species";
import { fuzzyScore } from "@/lib/utils/search";
import { cn } from "@/lib/utils";
import type { Node as DataNode } from "@/lib/data/types";
import type { SpeciesId } from "@arkaik/schema";

export interface NodeSearchComboboxProps {
  /** The species this list may offer, from the grammar. One or several. */
  species: readonly SpeciesId[];
  allNodes: DataNode[];
  /** Ids this list must not offer — already related, or the node itself. */
  excludeIds?: readonly string[];
  /**
   * Relate the node that was picked.
   *
   * Same contract as {@link onCreate}, because a line's two gestures are the
   * same write with a different subject: returning `false` means it failed,
   * and the query is then kept rather than cleared.
   */
  onSelect: (nodeId: string) => Promise<boolean | void> | boolean | void;
  /**
   * Create a node of this species with this title, and relate it.
   *
   * The species is a parameter because a line may admit more than one (an api
   * endpoint's `calls` reaches both endpoints and views), and the list then
   * offers one create row apiece — the caller cannot infer which was chosen.
   *
   * **Returning `false` means the write failed.** The typed query is then kept
   * rather than cleared: a caller that reports its own failure with a toast
   * still leaves the reader looking at a field they have to retype, and the
   * one thing they certainly still want is the words they just wrote.
   */
  onCreate?: (species: SpeciesId, title: string) => Promise<boolean | void> | boolean | void;
  /**
   * An extra last row for a value that is not a node at all — Blocked by's free
   * text. `render` draws it, `onCommit` takes the trimmed query.
   */
  freeText?: { render: (query: string) => React.ReactNode; onCommit: (text: string) => void };
  placeholder?: string;
  /** Focus the field on mount — for a list a gesture reveals. */
  autoFocus?: boolean;
  /**
   * Presentation, passed straight through to `Combobox`. A caller that puts
   * this list inside an `AddPopover` spreads `ADD_POPOVER_COMBOBOX` rather
   * than picking these one at a time.
   */
  search?: boolean;
  className?: string;
  listClassName?: string;
  /**
   * `popover` (the default) floats the list over what follows; `inline` pushes
   * it down. A relation line passes `inline`: the panel body scrolls, and a
   * floated list inside it would need portalling to escape the scroll
   * container.
   */
  placement?: "popover" | "inline";
  disabled?: boolean;
}

interface Candidate {
  id: string;
  title: string;
  score: number;
}

/**
 * What the list offers: the nodes that match, then — once something is typed
 * that no node of an admissible species answers to — the row that creates it,
 * one per species.
 *
 * The create affordance used to sit *under* the list as a footer `<Button>`,
 * which is precisely where the arrow keys cannot reach it (audit `shadcn-6`).
 * Now that Tab dismisses the list instead of walking into it, a footer button
 * would have had no keyboard route at all, so it rides in the same array as the
 * matches and is reached the same way: arrow to it, press Enter.
 */
type Row =
  | { kind: "node"; id: string; title: string }
  | { kind: "create"; species: SpeciesId; title: string }
  | { kind: "free-text"; title: string };

const speciesLabel = (id: SpeciesId) => SPECIES.find((s) => s.id === id)?.label ?? id;

/**
 * The ghost-button treatment the create row has always had, now shared by every
 * row that is an action rather than a match.
 *
 * `first` draws the separator rule above it — only above the *first* action row,
 * or two stacked creates would draw two lines through the list.
 */
const actionRowClass = (active: boolean, first: boolean) =>
  cn(
    // Still the ghost button it has always looked like, drawn from the
    // same `cva` rather than from a copy of its classes.
    buttonVariants({ variant: "ghost", size: "sm" }),
    "w-full justify-start",
    // The rule above it used to be a wrapping `<div className="border-t
    // mt-1 pt-1">`, which cannot survive the row becoming a single
    // `role="option"` box. A pseudo-element reproduces it exactly —
    // `mt-2` opens the same 8px, `-top-1` puts the line at its middle —
    // and leaves the button's own geometry untouched.
    first &&
      "relative mt-2 before:absolute before:inset-x-0 before:-top-1 before:border-t before:border-border",
    active && "bg-accent text-accent-foreground dark:bg-accent/50",
  );

export function NodeSearchCombobox({
  species,
  allNodes,
  excludeIds,
  onSelect,
  onCreate,
  freeText,
  placeholder,
  autoFocus,
  search,
  className,
  listClassName,
  placement,
  disabled,
}: NodeSearchComboboxProps) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);

  const candidates = useMemo(() => {
    const scoped = allNodes
      .filter((node) => species.includes(node.species))
      .filter((node) => !excludeIds?.includes(node.id))
      .map((node) =>
        ({
          id: node.id,
          title: node.title,
          score: fuzzyScore(query, `${node.id} ${node.title}`),
        }) satisfies Candidate,
      )
      .filter((candidate) => candidate.score >= 0)
      .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));

    // One cap over the whole list, not one per species. On a line admitting
    // several, a query matching nine api endpoints therefore hides every view
    // that also matched. Capping per species instead would change what "the
    // eight best answers" means — it would promote a weak match of a rare
    // species over a strong one of a common one — so the ranking stays global
    // until multi-species lines are common enough to show whether this reads
    // badly in practice.
    return scoped.slice(0, 8);
  }, [allNodes, excludeIds, query, species]);

  const trimmed = query.trim();
  // The two callbacks are read for their presence, never called, by everything
  // below. Depending on the booleans rather than on the functions is what keeps
  // the memo alive: a caller that builds its handlers inline — every
  // `RelationLine` does — hands this component a new function identity on every
  // render, and a memo keyed on those would rebuild on all of them.
  const canCreate = Boolean(onCreate);
  const hasFreeText = Boolean(freeText);

  // Per species, not across the list: "Login" existing as a view must not
  // suppress the offer to create a flow by that name.
  const canCreateIn = useCallback(
    (candidate: SpeciesId) =>
      Boolean(trimmed) &&
      canCreate &&
      !allNodes.some(
        (node) => node.species === candidate && node.title.toLowerCase() === trimmed.toLowerCase(),
      ),
    [allNodes, canCreate, trimmed],
  );

  const rows = useMemo<Row[]>(() => {
    const matches: Row[] = candidates.map((candidate) => ({
      kind: "node",
      id: candidate.id,
      title: candidate.title,
    }));
    const creates: Row[] = species
      .filter(canCreateIn)
      .map((candidate) => ({ kind: "create", species: candidate, title: trimmed }));
    const free: Row[] = hasFreeText && trimmed ? [{ kind: "free-text", title: trimmed }] : [];
    return [...matches, ...creates, ...free];
  }, [candidates, canCreateIn, hasFreeText, species, trimmed]);

  const firstActionIndex = rows.findIndex((row) => row.kind !== "node");

  async function handleCreate(candidate: SpeciesId) {
    if (!onCreate || !trimmed || busy) return;
    setBusy(true);
    try {
      // Cleared only on success. A failed write leaves the query where it was
      // so the retry is one Enter away rather than a retype.
      if ((await onCreate(candidate, trimmed)) !== false) setQuery("");
    } finally {
      setBusy(false);
    }
  }

  /**
   * The mirror of {@link handleCreate}, down to holding `busy` for the
   * duration.
   *
   * Both gestures are one write against a store this component does not own,
   * so both keep the field disabled until it settles and both keep the typed
   * query when it fails.
   *
   * The `busy` entry guard is defence rather than a live race today:
   * `Combobox.select()` sets `open` false *before* it calls back, so the list
   * is already gone by the render that turns `busy` on, and nothing can bring
   * it back while the field is disabled. It is what keeps that true if a
   * caller ever reopens the list over a write in flight.
   */
  async function handleSelect(nodeId: string) {
    if (busy) return;
    setBusy(true);
    try {
      if ((await onSelect(nodeId)) !== false) setQuery("");
    } finally {
      setBusy(false);
    }
  }

  const speciesPhrase = species.map((id) => `${speciesLabel(id).toLowerCase()}s`).join(" or ");

  return (
    <Combobox<Row>
      value={query}
      onValueChange={setQuery}
      items={rows}
      itemKey={(row) =>
        row.kind === "node" ? row.id : row.kind === "create" ? `create:${row.species}` : "free-text"
      }
      onSelect={(row) => {
        if (row.kind === "create") void handleCreate(row.species);
        else if (row.kind === "free-text") {
          if (busy) return;
          freeText?.onCommit(row.title);
          setQuery("");
        } else void handleSelect(row.id);
      }}
      renderItem={(row) =>
        row.kind === "create" ? (
          species.length > 1 ? (
            <>
              Create {speciesLabel(row.species).toLowerCase()} &quot;{row.title}&quot;
            </>
          ) : (
            <>Create &quot;{row.title}&quot;</>
          )
        ) : row.kind === "free-text" ? (
          freeText?.render(row.title)
        ) : (
          <>
            <span className="font-medium">{row.title}</span>
            <span className="ml-2 text-xs text-muted-foreground">{row.id}</span>
          </>
        )
      }
      itemClassName={(row, active) =>
        row.kind === "node"
          ? cn("w-full rounded-sm px-2 py-1.5 text-left text-sm", active && "bg-muted")
          : actionRowClass(active, rows.indexOf(row) === firstActionIndex)
      }
      empty={<p className="px-2 py-2 text-xs text-muted-foreground">No matches.</p>}
      placeholder={placeholder ?? `Search ${speciesPhrase}...`}
      // The create clause is conditional: a read-only line searches what
      // already exists and has no create row to announce.
      aria-label={
        canCreate ? `Search existing ${speciesPhrase} or create one` : `Search ${speciesPhrase}`
      }
      autoFocus={autoFocus}
      search={search}
      className={className}
      listClassName={listClassName}
      placement={placement}
      disabled={disabled || busy}
    />
  );
}
