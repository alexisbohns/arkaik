"use client";

/**
 * The marks a decision is drawn with, on the Decisions page and in its panel:
 * the status seal and pill, the decorative shapes, a row's related-count tiles
 * and its Why·How cue. Each status-bearing piece carries `data-dc-status`, so
 * app/m3/decisions.css derives the tone (hue, tint, ink) once per status, in
 * light and dark — the decision vocabulary's own families (neutral, indigo,
 * green, red, amber, plum).
 */
import type { ReactNode } from "react";
import { DiamondPlusIcon, LoaderIcon } from "lucide-react";
import type { Node } from "@/lib/data/types";
import type { DecisionStatusId } from "@/lib/utils/decision";
import { DECISION_STATUS_LABEL, type DecisionRowModel } from "@/lib/utils/decision-log";
import { EXPRESSIVE_SHAPES, type ExpressiveShapeName } from "@/components/arkademy/ExpressiveShape";
import { DECISION_STATUS_ICONS } from "@/components/graph/nodes/node-styles";
import { RelatedNodesPopover } from "@/components/layout/RelatedNodesPopover";
import { cn } from "@/lib/utils";

/**
 * Shape says state as well as colour: an open call is a dashed cookie (open on
 * purpose), an approved one a solid nine-cookie, an enacted one the decision's
 * own flower in full; the three exits fall back to a tint.
 */
const SEAL: Record<DecisionStatusId, { shape: ExpressiveShapeName; fill: "open" | "solid" | "tint" }> = {
  proposed: { shape: "cookie12", fill: "open" },
  approved: { shape: "cookie9", fill: "solid" },
  enacted: { shape: "flower", fill: "solid" },
  rejected: { shape: "cookie12", fill: "tint" },
  deprecated: { shape: "cookie12", fill: "tint" },
  superseded: { shape: "clover4", fill: "tint" },
};

export type SealSize = "xs" | "s" | "m" | "l" | "xl";

/** A status seal. Decorative: the status is always also said in words, beside it or in the caller's sr text. */
export function StatusSeal({ status, size = "m", className }: { status: DecisionStatusId; size?: SealSize; className?: string }) {
  const Icon = DECISION_STATUS_ICONS[status] ?? DECISION_STATUS_ICONS.proposed;
  const seal = SEAL[status] ?? SEAL.proposed;
  return (
    <span className={cn("dc-seal", className)} data-dc-status={status} data-fill={seal.fill} data-size={size} aria-hidden="true">
      <svg viewBox="0 0 100 100" className="dc-seal-shape" focusable="false">
        <path d={EXPRESSIVE_SHAPES[seal.shape]} vectorEffect="non-scaling-stroke" />
      </svg>
      <Icon className="dc-seal-icon" />
    </span>
  );
}

/** A decorative expressive shape, filled with currentColor. */
export function Shape({ name, className }: { name: ExpressiveShapeName; className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true" focusable="false">
      <path d={EXPRESSIVE_SHAPES[name]} fill="currentColor" />
    </svg>
  );
}

/** A status as a tonal pill: its glyph and its word. */
export function StatusPill({ status, children, className }: { status: DecisionStatusId; children?: ReactNode; className?: string }) {
  const Icon = DECISION_STATUS_ICONS[status] ?? DECISION_STATUS_ICONS.proposed;
  return (
    <span className={cn("dc-pill", className)} data-dc-status={status}>
      <Icon className="dc-pill-icon" aria-hidden="true" />
      <span className="dc-pill-label">{DECISION_STATUS_LABEL[status]}</span>
      {children}
    </span>
  );
}

/**
 * A row's related nodes as tonal tiles, each the trigger of the shared
 * {@link RelatedNodesPopover} — the list the Library's "Used in" column opens.
 * A word as well as a number ("3 surfaces"), because two glyphs on one line
 * cannot both be self-evident; the accessible name carries the list's name.
 *
 * **Both tiles are neutral.** The one thing colour means on a decision row is
 * its status: a green acceptance tile beside a green `enacted` chip would be
 * two greens saying different things at one glance.
 */
export function RelatedTiles({ row, onSelect }: { row: DecisionRowModel; onSelect: (node: Node) => void }) {
  return (
    <>
      <RelatedTile icon={<LoaderIcon aria-hidden="true" />} label="Impacted surfaces" unit="surface" nodes={row.impacted} onSelect={onSelect} />
      <RelatedTile icon={<DiamondPlusIcon aria-hidden="true" />} label="Generated acceptances" unit="acceptance" nodes={row.generated} onSelect={onSelect} />
    </>
  );
}

function RelatedTile({
  icon,
  label,
  unit,
  nodes,
  onSelect,
}: {
  icon: ReactNode;
  /** What the list is, for the heading and the accessible name. */
  label: string;
  /** The singular noun the count is of — pluralised here. */
  unit: string;
  nodes: readonly Node[];
  onSelect: (node: Node) => void;
}) {
  if (nodes.length === 0) return null;
  return (
    <RelatedNodesPopover
      label={label}
      nodes={nodes}
      onSelect={onSelect}
      trigger={
        <button type="button" aria-label={`${label} (${nodes.length})`} className="dc-tile">
          <span className="dc-tile-icon">{icon}</span>
          <span className="dc-tile-count">{nodes.length}</span>
          <span className="dc-tile-unit">
            {unit}
            {nodes.length === 1 ? "" : "s"}
          </span>
        </button>
      }
    />
  );
}

/** "Why · How": whether the decision's two halves of reasoning are written. Words, not colour alone. */
export function ReasoningCue({ hasContext, hasConsequences }: { hasContext: boolean; hasConsequences: boolean }) {
  return (
    <span className="dc-adr">
      <span data-on={hasContext ? "" : undefined}>
        Why<span className="sr-only">{hasContext ? " written" : " missing"}</span>
      </span>
      <span data-on={hasConsequences ? "" : undefined}>
        How<span className="sr-only">{hasConsequences ? " written" : " missing"}</span>
      </span>
    </span>
  );
}

/** A count with its noun: "1 decision", "3 decisions". */
export function plural(count: number, noun: string, many = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : many}`;
}
