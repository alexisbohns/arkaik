"use client";

import { GitBranchIcon, SplitIcon } from "lucide-react";
import { PRODUCT_MEMBERSHIP_SPECIES } from "@arkaik/schema";
import type { Node } from "@/lib/data/types";
import type { PlatformStatusMap } from "@/lib/data/types";
import type { PlatformStatusRollup } from "@/lib/utils/platform-status";
import { getEditablePlatformStatuses, scopedRollupPlatforms } from "@/lib/utils/platform-status";
import { scopedPlatforms, type ProductScope } from "@/lib/utils/product-scope";
import type { SpeciesId } from "@/lib/config/species";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PlatformGaugeList } from "@/components/graph/nodes/PlatformGaugeList";
import { PlatformList } from "@/components/graph/nodes/PlatformList";
import {
  PLATFORM_ICONS,
  PLATFORM_LABELS,
  SPECIES_ICONS,
} from "@/components/graph/nodes/node-styles";
import { SpeciesBadge, EntityId } from "@/components/graph/nodes/EntityBadges";
import { ValueBadge } from "@/components/values/ValueBadge";

export interface PlaylistPreviewItem {
  type: "view" | "flow" | "condition" | "junction";
  label: string;
}

interface NodeCardProps {
  node: Node;
  speciesLabel: string;
  speciesDescription?: string;
  viewPlatformStatuses?: PlatformStatusMap;
  flowRollup?: PlatformStatusRollup;
  playlistPreview: PlaylistPreviewItem[];
  usedInCount: number;
  /** The surface's product scope — resolved once at the page, never per card. */
  scope: ProductScope;
  /**
   * This node's products as titles, from `productLabelsOfNode`.
   *
   * **`undefined` and `[]` are different answers.** `undefined` means the
   * project declares no products at all, and the card renders exactly as it did
   * before this feature existed — no badge, no new word. `[]` means products
   * exist and this node is in none of them, which for a data model or endpoint
   * is the orphan worth flagging (§ Decision 8).
   */
  productLabels?: string[];
  /**
   * This card's selection state, or `undefined` when the surface has no
   * selection at all.
   *
   * **`undefined` and `false` are different answers**, the same distinction
   * `productLabels` above draws. `undefined` means no selection mechanism
   * exists here and the card renders exactly as it did before selection did —
   * no checkbox, no gutter, no layout shift. `false` means the surface *does*
   * select and this card simply is not selected, which is a box to tick.
   */
  selected?: boolean;
  onToggleSelected?: (nodeId: string) => void;
  onClick: () => void;
}

/**
 * The product annotation, which reads differently for the two halves of the
 * graph — the same split {@link productsOfNode} draws.
 *
 * A flow, view, or acceptance *stores* its membership, so its badge is a
 * statement of fact: this belongs to the Admin dashboard. A data model or
 * endpoint only ever derives one from who reaches it, so its badge is a
 * traversal result and says so — "Used by: End-user, Admin" — and an empty
 * traversal is itself the finding: nothing reaches this node.
 *
 * That asymmetry is why an unassigned flow renders nothing here while an
 * unreached data model renders "Unattached". "No product yet" is a gap in
 * authoring that the All-products list already surfaces by showing the node;
 * "nothing points at this" is a gap in the graph, and it is the one a reader
 * scanning a library of hundreds of cards needs pointed out.
 */
function ProductAnnotation({ species, labels }: { species: SpeciesId; labels: string[] }) {
  const derived = !PRODUCT_MEMBERSHIP_SPECIES.includes(species);

  if (labels.length === 0) {
    if (!derived) return null;
    return <Badge variant="outline">Unattached</Badge>;
  }

  if (derived) {
    return <Badge variant="secondary">Used by: {labels.join(", ")}</Badge>;
  }

  return (
    <>
      {labels.map((label) => (
        <Badge key={label} variant="secondary">{label}</Badge>
      ))}
    </>
  );
}

function PlaylistItemIcon({ type }: { type: PlaylistPreviewItem["type"] }) {
  if (type === "condition") {
    return <GitBranchIcon className="size-3.5 text-muted-foreground" />;
  }

  if (type === "junction") {
    return <SplitIcon className="size-3.5 text-muted-foreground" />;
  }

  const SpeciesIcon = SPECIES_ICONS[type as SpeciesId];
  return <SpeciesIcon className="size-3.5 text-muted-foreground" />;
}

export function NodeCard({
  node,
  speciesLabel,
  speciesDescription,
  viewPlatformStatuses,
  flowRollup,
  playlistPreview,
  usedInCount,
  scope,
  productLabels,
  selected,
  onToggleSelected,
  onClick,
}: NodeCardProps) {
  const previewItems = playlistPreview.slice(0, 5);
  // With no products declared this returns `node.platforms` unchanged, which is
  // what keeps a product-less project pixel-identical to today.
  const platforms = scopedPlatforms(node, scope);

  return (
    <article
      tabIndex={0}
      data-wobble-group
      className="w-full cursor-pointer"
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
    >
      <Card className="h-full gap-3 py-4 transition-colors hover:bg-muted/40">
        <CardHeader className="gap-2 px-4">
          {/*
            The title row gains a gutter only when the surface selects. With
            `selected === undefined` the title is rendered bare, exactly as it
            was before selection existed — not inside a one-child flex row that
            would be *almost* the same box. "Almost" is how a gallery of cards
            drifts a pixel for every project that never asked for this.

            `stopPropagation` on the click is what keeps ticking a box from
            opening the node: the whole card is a click target.
          */}
          {selected === undefined ? (
            <CardTitle className="line-clamp-2 text-base leading-tight">{node.title}</CardTitle>
          ) : (
            <div className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={selected}
                aria-label={`Select ${node.title}`}
                className="mt-0.5 size-4 shrink-0 cursor-pointer accent-primary"
                onClick={(event) => event.stopPropagation()}
                onChange={() => onToggleSelected?.(node.id)}
              />
              <CardTitle className="line-clamp-2 min-w-0 flex-1 text-base leading-tight">
                {node.title}
              </CardTitle>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <SpeciesBadge
              species={node.species}
              label={speciesLabel}
              description={speciesDescription}
              onClick={(e) => { e.stopPropagation(); }}
            />
            <EntityId id={node.id} />
            {productLabels !== undefined && (
              <ProductAnnotation species={node.species} labels={productLabels} />
            )}
          </div>
        </CardHeader>

        <CardContent className="space-y-2 px-4 pb-1 text-xs">
          {node.species === "view" && (
            <div className="space-y-1.5">
              <span className="text-muted-foreground">Platforms</span>
              <PlatformList platforms={platforms} platformStatuses={viewPlatformStatuses} />
            </div>
          )}

          {node.species === "flow" && flowRollup && (
            <div className="space-y-1.5">
              <span className="text-muted-foreground">Platforms</span>
              {/* Clamped, not replaced: the rollup can count a platform the flow
                  never declares, and under All products that bar must survive.
                  See `scopedRollupPlatforms`. */}
              <PlatformGaugeList
                rollup={flowRollup}
                platforms={scopedRollupPlatforms(node.platforms, flowRollup, scope.platforms)}
                showLabels
              />
            </div>
          )}

          {node.species === "acceptance" && (
            <div className="space-y-2">
              {typeof node.metadata?.gherkin === "string" && node.metadata.gherkin && (
                <p className="line-clamp-2 text-[11px] text-muted-foreground">{node.metadata.gherkin}</p>
              )}
              {(node.metadata?.values ?? []).length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {(node.metadata?.values ?? []).map((v) => <ValueBadge key={v} valueId={v} />)}
                </div>
              )}
              <div className="space-y-1.5">
                <span className="text-muted-foreground">Platforms</span>
                <PlatformList
                  platforms={platforms}
                  platformStatuses={getEditablePlatformStatuses(node)}
                />
              </div>
            </div>
          )}

          {node.species !== "view" && node.species !== "flow" && node.species !== "acceptance" && (
            <div className="space-y-1.5">
              <span className="text-muted-foreground">Platforms</span>
              {platforms.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2">
                  {platforms.map((platformId) => {
                    const PlatformIcon = PLATFORM_ICONS[platformId];
                    return (
                      <span key={platformId} className="inline-flex items-center gap-1.5 text-muted-foreground">
                        <PlatformIcon className="size-3.5" />
                        {PLATFORM_LABELS[platformId]}
                      </span>
                    );
                  })}
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground">No platforms selected.</p>
              )}
            </div>
          )}

          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Used in</span>
            <span>{usedInCount > 0 ? `${usedInCount} flow${usedInCount === 1 ? "" : "s"}` : "-"}</span>
          </div>

          {node.species === "flow" && (
            <div className="space-y-1">
              <span className="text-muted-foreground">Playlist</span>
              {previewItems.length > 0 ? (
                <ul className="space-y-1 text-[11px]">
                  {previewItems.map((item, index) => (
                    <li key={`${node.id}-preview-${index}`} className="inline-flex w-full items-center gap-1.5 truncate text-muted-foreground">
                      <PlaylistItemIcon type={item.type} />
                      <span className="truncate">{item.label}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[11px] text-muted-foreground">No entries yet.</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </article>
  );
}
