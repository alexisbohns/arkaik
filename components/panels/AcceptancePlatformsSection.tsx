"use client";

import { useState } from "react";
import type { Node, PlatformStatusMap } from "@/lib/data/types";
import type { PlatformId } from "@/lib/config/platforms";
import type { ProductScope } from "@/lib/utils/product-scope";
import { getEditablePlatformStatuses } from "@/lib/utils/platform-status";
import { PlatformVariants } from "@/components/panels/PlatformVariants";
import type { ScreenshotPanelOp } from "@/lib/utils/screenshot-ops";
import { useScreenshotStaleness } from "@/lib/hooks/useScreenshotStaleness";
import type { PlatformScreenshotMetaMap } from "@arkaik/schema";

interface AcceptancePlatformsSectionProps {
  node: Node;
  scope: ProductScope;
  onUpdate: (id: string, patch: Partial<Omit<Node, "id" | "project_id">>) => Promise<void> | void;
  /** Screenshot writes go through the op, never through `onUpdate` — see `NodeDetailPanel`. */
  onScreenshot?: (op: ScreenshotPanelOp) => Promise<void> | void;
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
 * through, which is what `AcceptanceEditor` always did here. Screenshots are
 * the exception on both: they are recorded and removed as ops, so the journal
 * sees them, and read back off the node.
 */
export function AcceptancePlatformsSection({ node, scope, onUpdate, onScreenshot }: AcceptancePlatformsSectionProps) {
  const statuses: PlatformStatusMap = getEditablePlatformStatuses(node);
  const screenshotMeta = (node.metadata?.platformScreenshotMeta ?? {}) as PlatformScreenshotMetaMap;
  const stale = useScreenshotStaleness(node.id, scope.platforms, screenshotMeta);
  // Holds every control while an op is in flight: `patchMetadata` spreads the
  // pre-op `node.metadata`, and `update_node` replaces metadata wholesale, so a
  // note typed during the window would overwrite the fresh slot. Same hazard
  // and same hold as `PlatformVariantsSection`.
  const [shotPending, setShotPending] = useState(false);

  async function runScreenshotOp(op: ScreenshotPanelOp) {
    if (!onScreenshot) return;
    setShotPending(true);
    try {
      await onScreenshot(op);
    } finally {
      setShotPending(false);
    }
  }

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
      screenshotMeta={screenshotMeta}
      stale={stale}
      busy={shotPending}
      onStatusChange={(platform: PlatformId, value) => {
        const next = { ...statuses };
        if (value) next[platform] = value; else delete next[platform];
        patchMetadata({ platformStatuses: next });
      }}
      onNotesChange={(platform: PlatformId, value) =>
        patchMetadata({ platformNotes: { ...node.metadata?.platformNotes, [platform]: value } })
      }
      onRecordScreenshot={
        onScreenshot
          ? (platform, form, value) => {
              void runScreenshotOp({ op: "record_screenshot", node_id: node.id, platform, source: "manual", form, value });
            }
          : undefined
      }
      onRemoveScreenshot={
        onScreenshot
          ? (platform) => {
              void runScreenshotOp({ op: "remove_screenshot", node_id: node.id, platform });
            }
          : undefined
      }
    />
  );
}
