"use client";

import { useMemo, useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { fuzzyScore } from "@/lib/utils/search";
import { cn } from "@/lib/utils";
import type { Node as DataNode } from "@/lib/data/types";

interface NodeSearchComboboxProps {
  species: "view" | "flow";
  allNodes: DataNode[];
  onSelect: (nodeId: string) => void;
  onCreate?: (title: string) => Promise<void> | void;
  disabled?: boolean;
}

interface Candidate {
  id: string;
  title: string;
  score: number;
}

/**
 * What the list offers: the nodes that match, then — once something is typed
 * that no node of this species answers to — the row that creates it.
 *
 * The create affordance used to sit *under* the list as a footer `<Button>`,
 * which is precisely where the arrow keys cannot reach it (audit `shadcn-6`).
 * Now that Tab dismisses the list instead of walking into it, a footer button
 * would have had no keyboard route at all, so it rides in the same array as the
 * matches and is reached the same way: arrow to it, press Enter.
 */
type Row = { kind: "node"; id: string; title: string } | { kind: "create"; title: string };

export function NodeSearchCombobox({
  species,
  allNodes,
  onSelect,
  onCreate,
  disabled,
}: NodeSearchComboboxProps) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);

  const candidates = useMemo(() => {
    const scoped = allNodes
      .filter((node) => node.species === species)
      .map((node) => {
        const searchable = `${node.id} ${node.title}`;
        return {
          id: node.id,
          title: node.title,
          score: fuzzyScore(query, searchable),
        } satisfies Candidate;
      })
      .filter((candidate) => candidate.score >= 0)
      .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));

    return scoped.slice(0, 8);
  }, [allNodes, query, species]);

  const trimmed = query.trim();
  const hasExactTitle = allNodes.some(
    (node) => node.species === species && node.title.toLowerCase() === trimmed.toLowerCase(),
  );
  const canCreate = Boolean(trimmed) && Boolean(onCreate) && !hasExactTitle;

  const rows = useMemo<Row[]>(() => {
    const matches: Row[] = candidates.map((candidate) => ({
      kind: "node",
      id: candidate.id,
      title: candidate.title,
    }));
    return canCreate ? [...matches, { kind: "create", title: trimmed }] : matches;
  }, [candidates, canCreate, trimmed]);

  async function handleCreate() {
    if (!onCreate || !trimmed || busy) return;
    setBusy(true);
    try {
      await onCreate(trimmed);
      setQuery("");
    } finally {
      setBusy(false);
    }
  }

  function handleSelect(nodeId: string) {
    onSelect(nodeId);
    setQuery("");
  }

  return (
    <Combobox<Row>
      value={query}
      onValueChange={setQuery}
      items={rows}
      itemKey={(row) => (row.kind === "create" ? "create" : row.id)}
      onSelect={(row) => {
        if (row.kind === "create") void handleCreate();
        else handleSelect(row.id);
      }}
      renderItem={(row) =>
        row.kind === "create" ? (
          <>Create &quot;{row.title}&quot;</>
        ) : (
          <>
            <span className="font-medium">{row.title}</span>
            <span className="ml-2 text-xs text-muted-foreground">{row.id}</span>
          </>
        )
      }
      itemClassName={(row, active) =>
        row.kind === "create"
          ? cn(
              // Still the ghost button it has always looked like, drawn from the
              // same `cva` rather than from a copy of its classes.
              buttonVariants({ variant: "ghost", size: "sm" }),
              // The rule above it used to be a wrapping `<div className="border-t
              // mt-1 pt-1">`, which cannot survive the row becoming a single
              // `role="option"` box. A pseudo-element reproduces it exactly —
              // `mt-2` opens the same 8px, `-top-1` puts the line at its middle —
              // and leaves the button's own geometry untouched.
              "relative mt-2 w-full justify-start before:absolute before:inset-x-0 before:-top-1 before:border-t before:border-border",
              active && "bg-accent text-accent-foreground dark:bg-accent/50",
            )
          : cn("w-full rounded-sm px-2 py-1.5 text-left text-sm", active && "bg-muted")
      }
      empty={<p className="px-2 py-2 text-xs text-muted-foreground">No matches.</p>}
      placeholder={`Search ${species}s...`}
      aria-label={`Search existing ${species} nodes or create a new one`}
      disabled={disabled || busy}
    />
  );
}
