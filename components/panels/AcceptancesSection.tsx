"use client";

import type { Node, Edge } from "@/lib/data/types";
import type { SpeciesId } from "@arkaik/schema";
import { acceptancesCovering, hasParityGap } from "@arkaik/schema";
import { getEditablePlatformStatuses } from "@/lib/utils/platform-status";
import { scopedPlatforms, type ProductScope } from "@/lib/utils/product-scope";
import { PlatformList } from "@/components/graph/nodes/PlatformList";
import { PlatformStatusIcons } from "@/components/graph/nodes/PlatformStatusIcons";
import { EntityRow } from "@/components/graph/nodes/EntityRow";
import { RelationLine } from "@/components/panels/RelationLine";
import { useDisplayPreferences } from "@/lib/hooks/useDisplayPreferences";
import { useProjectId } from "@/lib/hooks/useProjectId";
import { TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";

/**
 * The only species this line's search may reach. A module constant, not an
 * inline array: the combobox memoises its candidate list on its identity.
 */
const ACCEPTANCE_SPECIES: readonly SpeciesId[] = ["acceptance"];

interface AcceptancesSectionProps {
  node: Node;
  allNodes: Node[];
  allEdges: Edge[];
  /** The surface's product scope — the chips show each acceptance's effective platforms. */
  scope: ProductScope;
  onNavigate?: (node: Node) => void;
  onCreate?: (anchor: Node, title: string) => Promise<Node>;
}

/**
 * The acceptances covering a view or a flow.
 *
 * Two displays, chosen by the reader in the project's Settings → Display
 * preferences (`useDisplayPreferences`) and defaulting to `rows`: one line per
 * acceptance, with the platforms folded into a single strip of status-coloured
 * glyphs. The `cards` display is what shipped first — a bordered block per
 * acceptance with every platform on its own labelled line — and it stays
 * available because it is the one that reads a platform's *name*, which matters
 * on a project whose platforms are not obvious from a glyph.
 *
 * The preference is read here rather than threaded down from the page: it is a
 * property of the reader, not of the surface, and every panel showing this
 * section must switch together.
 */
export function AcceptancesSection({ node, allNodes, allEdges, scope, onNavigate, onCreate }: AcceptancesSectionProps) {
  const projectId = useProjectId();
  const [{ acceptanceDisplay }] = useDisplayPreferences(projectId);
  const covering = acceptancesCovering(node.id, allNodes, allEdges);
  return (
    <RelationLine
      label="Acceptances"
      add={
        onCreate && {
          counterpartSpecies: ACCEPTANCE_SPECIES,
          allNodes,
          // SCAFFOLD (part 2 only — part 3 task 3.5 deletes this line).
          // Every acceptance is excluded, so the list can only ever reach its
          // create row: attaching an *existing* acceptance is a `covers` edge
          // written from the anchor's side, and that write path arrives with
          // the `relations` capability in part 3.
          excludeIds: [node.id, ...allNodes.filter((n) => n.species === "acceptance").map((n) => n.id)],
          placeholder: "Search acceptances or name a new one...",
          onSelect: () => {
            // Attaching an existing acceptance lands in part 3 with the
            // `relations` capability; until then the list offers only the
            // create row, so this is unreachable rather than a silent failure.
          },
          onCreate: async (_species: SpeciesId, title: string) => {
            try {
              await onCreate(node, title);
            } catch (err) {
              toast.error("Couldn't add the acceptance.");
              console.error(err);
            }
          },
        }
      }
    >
      {covering.length === 0 ? (
        <p className="text-xs text-muted-foreground">No acceptances cover this {node.species} yet.</p>
      ) : acceptanceDisplay === "cards" ? (
        <ul className="flex flex-col gap-2">
          {covering.map((acc) => (
            <li key={acc.id}>
              {/* The card's own frame and the row inside it are separate: the
                  border and padding are the card, the chip-plus-title line is
                  the same `EntityRow` the rows display uses, so a card and a row
                  can never disagree about what the chip does. `px-0` because the
                  card already supplies the gutter. */}
              <div className="flex flex-col gap-1 rounded-md border p-2 transition-colors hover:bg-muted/40">
                <EntityRow
                  node={acc}
                  onOpen={onNavigate && (() => onNavigate(acc))}
                  className="px-0 py-0"
                >
                  {hasParityGap(acc) && (
                    <TriangleAlertIcon className="size-3.5 shrink-0 text-amber-500" aria-label="Parity gap" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{acc.title}</span>
                </EntityRow>
                <PlatformList platforms={scopedPlatforms(acc, scope)} platformStatuses={getEditablePlatformStatuses(acc)} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        // No border and no card: rows are a list, and boxing each one drew the
        // reader's eye to the frames rather than to the titles. The hover fill
        // is what says a row is a target, exactly as it does in every other list
        // in a panel (`ConnectionItem`, `FindingsSection`).
        <ul className="flex flex-col gap-0.5">
          {covering.map((acc) => (
            <li key={acc.id}>
              <EntityRow node={acc} onOpen={onNavigate && (() => onNavigate(acc))}>
                {hasParityGap(acc) && (
                  <TriangleAlertIcon className="size-3.5 shrink-0 text-amber-500" aria-label="Parity gap" />
                )}
                <span className="min-w-0 flex-1 truncate">{acc.title}</span>
                <PlatformStatusIcons
                  className="shrink-0"
                  platforms={scopedPlatforms(acc, scope)}
                  platformStatuses={getEditablePlatformStatuses(acc)}
                />
              </EntityRow>
            </li>
          ))}
        </ul>
      )}
    </RelationLine>
  );
}
