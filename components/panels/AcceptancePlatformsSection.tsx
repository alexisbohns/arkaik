"use client";

import type { Node, PlatformStatusMap } from "@/lib/data/types";
import type { PlatformId } from "@/lib/config/platforms";
import type { ProductScope } from "@/lib/utils/product-scope";
import { getEditablePlatformStatuses } from "@/lib/utils/platform-status";
import { PlatformVariants } from "@/components/panels/PlatformVariants";

interface AcceptancePlatformsSectionProps {
  node: Node;
  scope: ProductScope;
  onUpdate: (id: string, patch: Partial<Omit<Node, "id" | "project_id">>) => Promise<void> | void;
}

/**
 * An acceptance's per-platform status, notes and screenshots.
 *
 * Lifted out of `AcceptanceEditor`, where it was a `Field` labelled
 * "Per-platform status" sitting below the Gherkin. It is the same thing a view's
 * panel calls Platform Variants and a flow's calls a rollup, and all three are
 * now one region named Platforms — so a reader walking three panels meets one
 * name for one shelf.
 *
 * No local state, unlike `PlatformVariantsSection`: this one patches straight
 * through, which is what `AcceptanceEditor` always did here.
 */
export function AcceptancePlatformsSection({ node, scope, onUpdate }: AcceptancePlatformsSectionProps) {
  const statuses: PlatformStatusMap = getEditablePlatformStatuses(node);

  function patchMetadata(next: Record<string, unknown>) {
    onUpdate(node.id, { metadata: { ...node.metadata, ...next } });
  }

  return (
    // The scope's MENU, not `scopedPlatforms(node, scope)` — see
    // `PlatformVariantsSection`. Shape decisions read `scope.platforms`;
    // per-node facts read `scopedPlatforms`.
    <PlatformVariants
      platforms={scope.platforms}
      statuses={statuses}
      notes={node.metadata?.platformNotes}
      screenshots={node.metadata?.platformScreenshots}
      onStatusChange={(platform: PlatformId, value) => {
        const next = { ...statuses };
        if (value) next[platform] = value; else delete next[platform];
        patchMetadata({ platformStatuses: next });
      }}
      onNotesChange={(platform: PlatformId, value) =>
        patchMetadata({ platformNotes: { ...node.metadata?.platformNotes, [platform]: value } })
      }
      onScreenshotChange={(platform: PlatformId, value) =>
        patchMetadata({ platformScreenshots: { ...node.metadata?.platformScreenshots, [platform]: value } })
      }
    />
  );
}
