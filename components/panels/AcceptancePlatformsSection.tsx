"use client";

import { useState, type CSSProperties } from "react";
import type { Edge, Node, PlatformStatusMap } from "@/lib/data/types";
import type { PlatformId } from "@/lib/config/platforms";
import type { StatusId } from "@/lib/config/statuses";
import type { ProductScope } from "@/lib/utils/product-scope";
import type { PromiseMark } from "@/lib/utils/acceptances-model";
import { getEditablePlatformStatuses } from "@/lib/utils/platform-status";
import { PanelGroup } from "@/components/panels/PanelGroup";
import { PANEL_GUTTER } from "@/components/panels/PanelSection";
import { PlatformVariants } from "@/components/panels/PlatformVariants";
import { statusTone } from "@/components/panels/species-shape";
import { PromiseMarkGlyph } from "@/components/acceptances/kit";
import { PLATFORM_LABELS, STATUS_LABELS } from "@/components/graph/nodes/node-styles";
import { StatusSelectItems } from "@/components/layout/StatusSelectItems";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ScreenshotPanelOp } from "@/lib/utils/screenshot-ops";
import { useAcceptancePanel } from "@/lib/hooks/useAcceptancePanel";
import { useScreenshotStaleness } from "@/lib/hooks/useScreenshotStaleness";
import type { PlatformScreenshotMetaMap } from "@arkaik/schema";

interface AcceptancePlatformsSectionProps {
  node: Node;
  scope: ProductScope;
  /** Absent on a read-only surface (the Changelog): the rows read, nothing is offered. */
  onUpdate?: (id: string, patch: Partial<Omit<Node, "id" | "project_id">>) => Promise<void> | void;
  /** Screenshot writes go through the op, never through `onUpdate` — see `NodeDetailPanel`. */
  onScreenshot?: (op: ScreenshotPanelOp) => Promise<void> | void;
  allNodes?: Node[];
  allEdges?: Edge[];
}

type Row = { mark: PromiseMark; name: string; target: PlatformId | undefined };

/**
 * An acceptance's per-platform status, notes and screenshots — the region the
 * view's panel calls Platform Variants and a flow's calls a rollup, all one
 * name for one shelf.
 *
 * A quiet list: one row per platform in the arity rule's own marks (the model's
 * `marks`), the platform's glyph and its name, and its status — a select when
 * there is a save path, words when there is not. A promise that lags says how
 * many platforms are behind in the bar. Notes and screenshots keep the whole
 * `PlatformVariants` editor, folded below ("Notes and screenshots"); read-only,
 * the notes and shots that exist are plain text and an image — no controls.
 *
 * Status writes patch straight through, as `AcceptanceEditor` always did;
 * screenshots are recorded and removed as ops, so the journal sees them, and
 * read back off the node.
 */
export function AcceptancePlatformsSection({ node, scope, onUpdate, onScreenshot, allNodes, allEdges }: AcceptancePlatformsSectionProps) {
  const { promise, platforms } = useAcceptancePanel({ node, allNodes, allEdges, scope, readOnly: !onUpdate });
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
    onUpdate?.(node.id, { metadata: { ...node.metadata, ...next } });
  }

  function setStatus(platform: PlatformId, value: StatusId | undefined) {
    const next = { ...statuses };
    if (value) next[platform] = value;
    else delete next[platform];
    patchMetadata({ platformStatuses: next });
  }

  const rows: Row[] = promise.marks.map((mark, i) => ({
    mark,
    // A single-status project has one mark and no platform in it: the first platform of the menu is the one the status belongs to.
    target: mark.platform ?? platforms[i] ?? platforms[0],
    name: mark.platform ? PLATFORM_LABELS[mark.platform] : "Status",
  }));
  const behind = promise.hasGap ? promise.lagging.length : 0;

  return (
    <PanelGroup title="Platforms" meta={behind > 0 ? <span className="kap-gap-chip">{behind} behind</span> : undefined}>
      <div className={PANEL_GUTTER}>
        <ul className="kap-qlist">
          {rows.map((row) => (
            <li key={row.name} className="kap-qrow" data-na={!row.mark.status || undefined}>
              <PromiseMarkGlyph mark={row.mark} size="md" />
              <span className="kap-qrow-name">{row.name}</span>
              {onUpdate ? (
                <StatusSelect row={row} explicit={statuses} multi={platforms.length > 1} onChange={setStatus} />
              ) : (
                <span className="kap-qrow-state">{row.mark.status ? STATUS_LABELS[row.mark.status] : "Does not apply"}</span>
              )}
            </li>
          ))}
        </ul>
        {onUpdate ? (
          <details className="kap-pdeck">
            <summary>Notes and screenshots</summary>
            <div className="kap-pdeck-body">
              {/* The scope's MENU, not `scopedPlatforms(node, scope)` — see
                  `PlatformVariantsSection`. Shape decisions read `scope.platforms`;
                  per-node facts read `scopedPlatforms`. */}
              <PlatformVariants
                platforms={scope.platforms}
                statuses={statuses}
                notes={node.metadata?.platformNotes}
                screenshots={node.metadata?.platformScreenshots}
                screenshotMeta={screenshotMeta}
                stale={stale}
                busy={shotPending}
                onStatusChange={setStatus}
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
            </div>
          </details>
        ) : (
          <ReadNotes node={node} rows={rows} />
        )}
      </div>
    </PanelGroup>
  );
}

/** One platform's status select — the same control the status deck carries. */
function StatusSelect({
  row,
  explicit,
  multi,
  onChange,
}: {
  row: Row;
  explicit: PlatformStatusMap;
  multi: boolean;
  onChange: (platform: PlatformId, value: StatusId | undefined) => void;
}) {
  const target = row.target;
  if (!target) return null;
  const current = row.mark.status ?? explicit[target];
  return (
    <Select value={current ?? ""} onValueChange={(v) => onChange(target, v === "unset" ? undefined : (v as StatusId))}>
      <SelectTrigger
        aria-label={`Status${multi ? ` for ${row.name}` : ""}`}
        data-np-status
        data-compact
        data-empty={!current || undefined}
        style={{ "--np-status-tone": statusTone(current) } as CSSProperties}
        className="w-auto"
      >
        <SelectValue placeholder="No status" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="unset">
          <span className="text-muted-foreground">No status</span>
        </SelectItem>
        <StatusSelectItems />
      </SelectContent>
    </Select>
  );
}

/** Read-only notes and screenshots: text and an image, no controls, nothing dead. */
function ReadNotes({ node, rows }: { node: Node; rows: Row[] }) {
  const notes = (node.metadata?.platformNotes ?? {}) as Partial<Record<PlatformId, string>>;
  const shots = (node.metadata?.platformScreenshots ?? {}) as Partial<Record<PlatformId, string>>;
  const items = rows.filter((row) => row.target && (notes[row.target] || shots[row.target]));
  if (items.length === 0) return null;
  return (
    <ul className="kap-pnotes" aria-label="Notes and screenshots">
      {items.map((row) => {
        const target = row.target!;
        return (
          <li key={target} className="kap-pnote">
            <span className="kap-pnote-name">{row.name}</span>
            {notes[target] && <p className="kap-pnote-text">{notes[target]}</p>}
            {shots[target] && (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="kap-pnote-shot" src={shots[target]} alt={`Screenshot${row.mark.platform ? ` for ${row.name}` : ""}`} loading="lazy" />
            )}
          </li>
        );
      })}
    </ul>
  );
}
