"use client";

import { useMemo, useState } from "react";
import { GitBranchIcon, PlusIcon, SplitIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SPECIES_GRAPH_ICONS } from "@/lib/config/species-icons";
import { wouldCreateCycle } from "@/lib/utils/cycle";
import { fuzzyScore } from "@/lib/utils/search";
import { cn } from "@/lib/utils";
import type { Node, PlaylistEntry } from "@/lib/data/types";

/** Beyond this the list stops being a shortlist; keep typing to narrow it. */
const MAX_MATCHES = 6;

type RefSpecies = "view" | "flow";

type AddRow =
  | { kind: "node"; id: string; title: string; species: RefSpecies }
  | { kind: "create"; species: RefSpecies; title: string }
  | { kind: "structure"; structure: "condition" | "junction" };

/**
 * Condition and junction take the icons the library's playlist preview already
 * gave them (`NodeCard.PlaylistItemIcon`), so the same two shapes mean the same
 * two things wherever a playlist is drawn.
 */
const STRUCTURE = {
  condition: { label: "Condition", hint: "Yes / No branches", Icon: GitBranchIcon },
  junction: { label: "Junction", hint: "One branch per case", Icon: SplitIcon },
} as const;

interface AddEntryButtonProps {
  flowNodeId: string;
  allNodes: Node[];
  entries: PlaylistEntry[];
  onChange: (entries: PlaylistEntry[]) => Promise<void> | void;
  onCycleBlocked: (candidateFlowId: string) => void;
  onCreateNode?: (species: RefSpecies, title: string) => Promise<Node>;
}

function createRefEntry(species: RefSpecies, id: string): PlaylistEntry {
  if (species === "view") return { type: "view", view_id: id };
  return { type: "flow", flow_id: id };
}

/**
 * Add a step: one small button, one list.
 *
 * **The kind of thing you are adding is not a question worth asking first.** The
 * composer this replaces was a dashed box holding a species `Select` beside
 * either a node search or a label field — three controls, permanently open at
 * the foot of every list *including every branch of every branch*, asking you to
 * classify before you could search. But the search already knows what it found:
 * a row that says "Checkout · flow" has answered the question the Select was
 * asking. So there is no Select. Everything the playlist can hold is a row in
 * one list — the nodes that match, the ones you could create under that name,
 * and the two branching shapes at the bottom — and the button collapses to
 * nothing until you want it.
 *
 * **Views and flows are searched together.** They were separated only because
 * the Select had already forced a choice; a playlist plays both, and the species
 * rides along as a chip on the row.
 *
 * A flow that would make the playlist eat itself still reports through
 * `onCycleBlocked` rather than vanishing from the list: a step you expected to
 * find and cannot is a worse puzzle than one that tells you why it refused.
 */
export function AddEntryButton({
  flowNodeId,
  allNodes,
  entries,
  onChange,
  onCycleBlocked,
  onCreateNode,
}: AddEntryButtonProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);

  const trimmed = query.trim();

  /**
   * Nothing is offered until something is typed. An unfiltered shortlist of six
   * out of a graph's several hundred views is six arbitrary rows — it reads as
   * a menu while behaving like a coincidence — so the resting popover is the two
   * branching shapes and an invitation to search, which is what the field is for.
   */
  const matches = useMemo(() => {
    if (!query.trim()) return [];

    return allNodes
      .filter((node): node is Node & { species: RefSpecies } =>
        node.species === "view" || node.species === "flow")
      .map((node) => ({
        kind: "node" as const,
        id: node.id,
        title: node.title,
        species: node.species,
        score: fuzzyScore(query, `${node.id} ${node.title}`),
      }))
      .filter((row) => row.score >= 0)
      .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
      .slice(0, MAX_MATCHES);
  }, [allNodes, query]);

  const rows = useMemo<AddRow[]>(() => {
    const list: AddRow[] = matches.map(({ kind, id, title, species }) => ({ kind, id, title, species }));

    if (trimmed && onCreateNode) {
      for (const species of ["view", "flow"] as const) {
        const taken = allNodes.some(
          (node) => node.species === species && node.title.toLowerCase() === trimmed.toLowerCase(),
        );
        if (!taken) list.push({ kind: "create", species, title: trimmed });
      }
    }

    list.push({ kind: "structure", structure: "condition" });
    list.push({ kind: "structure", structure: "junction" });
    return list;
  }, [matches, trimmed, onCreateNode, allNodes]);

  /** Whether anything precedes the two branching rows — see `itemClassName`. */
  const hasRowsAbove = rows.some((row) => row.kind !== "structure");

  async function push(entry: PlaylistEntry) {
    setOpen(false);
    setQuery("");
    await onChange([...entries, entry]);
  }

  async function handleSelect(row: AddRow) {
    if (busy) return;

    if (row.kind === "structure") {
      // The query doubles as the label when there is one — you typed a name for
      // the thing you were looking for and did not find, and naming it is the
      // next thing you would have done anyway. The row stays renameable in place.
      const label = trimmed || STRUCTURE[row.structure].label;
      await push(
        row.structure === "condition"
          ? { type: "condition", label, if_true: [], if_false: [] }
          : { type: "junction", label, cases: [{ label: "Case 1", entries: [] }] },
      );
      return;
    }

    if (row.kind === "node") {
      if (row.species === "flow" && wouldCreateCycle(flowNodeId, row.id, allNodes)) {
        onCycleBlocked(row.id);
        return;
      }
      await push(createRefEntry(row.species, row.id));
      return;
    }

    if (!onCreateNode) return;
    setBusy(true);
    try {
      const created = await onCreateNode(row.species, row.title);
      // The freshly created node is not in `allNodes` yet — the store has not
      // round-tripped — so the guard is run against a list that includes it.
      const withCreated = [...allNodes.filter((node) => node.id !== created.id), created];

      if (row.species === "flow" && wouldCreateCycle(flowNodeId, created.id, withCreated)) {
        onCycleBlocked(created.id);
        return;
      }
      await push(createRefEntry(row.species, created.id));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="cursor-pointer self-start text-muted-foreground">
          <PlusIcon className="size-4" />
          Add step
        </Button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-80 p-2">
        <Combobox<AddRow>
          value={query}
          onValueChange={setQuery}
          items={rows}
          placement="inline"
          search
          // Structure rows are constant, so their keys are too; a node and the
          // row that would create a node of the same name never collide because
          // the create row is keyed by species as well.
          itemKey={(row) =>
            row.kind === "node" ? row.id
              : row.kind === "create" ? `create-${row.species}`
                : `structure-${row.structure}`
          }
          onSelect={(row) => void handleSelect(row)}
          renderItem={(row) => {
            if (row.kind === "structure") {
              const { label, hint, Icon } = STRUCTURE[row.structure];
              return (
                <span className="flex min-w-0 items-center gap-2">
                  <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="font-medium">{label}</span>
                  <span className="truncate text-xs text-muted-foreground">{hint}</span>
                </span>
              );
            }

            if (row.kind === "create") {
              const Icon = SPECIES_GRAPH_ICONS[row.species];
              return (
                <span className="flex min-w-0 items-center gap-2">
                  <PlusIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="truncate">
                    Create {row.species} <span className="font-medium">&ldquo;{row.title}&rdquo;</span>
                  </span>
                  <Icon className="ml-auto size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                </span>
              );
            }

            const Icon = SPECIES_GRAPH_ICONS[row.species];
            return (
              <span className="flex min-w-0 items-center gap-2">
                <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="truncate font-medium">{row.title}</span>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">{row.id}</span>
              </span>
            );
          }}
          itemClassName={(row, active) =>
            cn(
              "w-full rounded-sm px-2 py-1.5 text-left text-sm",
              // The two structure rows are the tail of the list, not more
              // matches, so the first of them carries the rule that says so,
              // and only while there is something above for it to separate:
              // at rest the list IS the two rows, and a rule under nothing is
              // a line drawn for its own sake —
              // a pseudo-element, because a wrapping div cannot survive a row
              // being a single `role="option"` box (the trick
              // `NodeSearchCombobox` uses for its own create row).
              hasRowsAbove && row.kind === "structure" && row.structure === "condition" &&
                "relative mt-2 before:absolute before:inset-x-0 before:-top-1 before:border-t before:border-border",
              active && "bg-muted",
            )
          }
          empty={<p className="px-2 py-2 text-xs text-muted-foreground">No matches.</p>}
          placeholder="Search views and flows…"
          aria-label="Search a view or flow to play, or add a branch"
          disabled={busy}
          className="flex flex-col gap-2"
          listClassName="max-h-72 overflow-y-auto"
        />
      </PopoverContent>
    </Popover>
  );
}
