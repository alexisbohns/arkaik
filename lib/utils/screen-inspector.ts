/**
 * The Screens map's quick inspector and touch reveal, as plain data
 * (docs/superpowers/specs/2026-11-11-screens-map-design.md § Interaction).
 *
 * Pure: no React, no DOM. The wall model (`screen-wall.ts`) has already
 * decided every state, stale reason and live proof; this module only words
 * them for the inspector, places the touch chips under a selected frame, and
 * says what a selection or a cold `?node=` load should put on screen.
 *
 * Every `@/` import here is listed in tests/app/load-screen-inspector.js. Add
 * one and that loader throws by name until its table learns it.
 */

import { platformLabel, type PlatformId } from "@/lib/config/platforms";
import { STATUSES, type StatusId } from "@/lib/config/statuses";
import { formatShotDate } from "@/lib/utils/screenshot-ops";
import {
  cellWord,
  type PlatformCell,
  type ShotState,
  type Wall,
  type WallItem,
  type WallScreen,
} from "@/lib/utils/screen-wall";

/** How a row reads at a glance: a current live shot, a gap to fix, or nothing to act on. */
export type InspectorTone = "live" | "gap" | "quiet";

/** One platform's line in the inspector. Every string is ready to render; null means "leave the line out". */
export interface InspectorRow {
  platform: PlatformId;
  platformLabel: string;
  state: ShotState;
  /** The side-by-side word (`cellWord`): "Live", "Stale", "No shot", "Unset", "Absent" or a status label. */
  word: string;
  tone: InspectorTone;
  /** The status label, only when the word does not already say it ("Stale" and "No shot" are both Live). */
  status: string | null;
  /** "Shot 03/11/2026 · From CI", "Shot … · Recorded by hand", "Legacy shot". */
  shot: string | null;
  /** The newest stale reason, its date, and "and N more". */
  stale: string | null;
  /** "Live from a deploy · <date> · <detail>", "Live, set by hand · <date>", "No record of how this went live". */
  proof: string | null;
}

const TONES: Record<ShotState, InspectorTone> = {
  "live-current": "live",
  "live-stale": "gap",
  "live-no-shot": "gap",
  "not-live": "quiet",
  absent: "quiet",
};

const SOURCE_WORDS: Record<"ci" | "manual" | "legacy", string> = {
  ci: "From CI",
  manual: "Recorded by hand",
  legacy: "Legacy shot",
};

function dateOf(ts: string | null | undefined): string | undefined {
  return ts ? formatShotDate(ts) : undefined;
}

function statusLabel(status: StatusId): string {
  return STATUSES.find((entry) => entry.id === status)?.label ?? status;
}

/** Who recorded the slot's shot and when; null when the slot is empty. */
export function shotLine(cell: PlatformCell): string | null {
  const shot = cell.shot;
  if (!shot) return null;
  const who = SOURCE_WORDS[shot.source ?? "legacy"];
  const date = dateOf(shot.ts);
  return date ? `Shot ${date} · ${who}` : who;
}

/** Why the shot may be stale: the newest reason (the model orders them newest first) and how many more. */
export function staleLine(cell: PlatformCell): string | null {
  const [newest, ...rest] = cell.staleBecause;
  if (!newest) return null;
  const date = dateOf(newest.ts);
  const head = date ? `${newest.label} · ${date}` : newest.label;
  return rest.length > 0 ? `${head} · and ${rest.length} more` : head;
}

/** How the platform went live, as far as the journal can tell; null when the cell is not live. */
export function proofLine(cell: PlatformCell): string | null {
  const proof = cell.proof;
  if (!proof) return null;
  if (proof.kind === "unknown") return "No record of how this went live";
  const date = dateOf(proof.ts);
  const parts = proof.kind === "deploy" ? ["Live from a deploy", date, proof.detail] : ["Live, set by hand", date];
  return parts.filter((part): part is string => typeof part === "string" && part.length > 0).join(" · ");
}

/** One row per platform of the wall's menu, in `wall.platforms` order; a platform with no cell is left out. */
export function inspectorRows(wall: Wall, screen: WallScreen): InspectorRow[] {
  const rows: InspectorRow[] = [];
  for (const platform of wall.platforms) {
    const cell = screen.cells[platform];
    if (!cell) continue;
    const word = cellWord(cell);
    const label = cell.status ? statusLabel(cell.status) : null;
    rows.push({
      platform,
      platformLabel: platformLabel(platform),
      state: cell.state,
      word,
      tone: TONES[cell.state],
      status: cell.state !== "absent" && label !== null && label !== word ? label : null,
      shot: shotLine(cell),
      stale: staleLine(cell),
      proof: proofLine(cell),
    });
  }
  return rows;
}

export interface StripLink {
  stripId: string;
  title: string;
}

/** The strip the frame was selected in, and the view's other strips in strip order ("Also in …"). */
export function stripLinks(wall: Wall, screen: WallScreen, stripId: string): { current: StripLink | null; also: StripLink[] } {
  const titles = new Map(wall.strips.map((strip) => [strip.id, strip.title]));
  const link = (id: string): StripLink | null => {
    const title = titles.get(id);
    return title === undefined ? null : { stripId: id, title };
  };
  return {
    current: link(stripId),
    also: screen.stripIds
      .filter((id) => id !== stripId)
      .map(link)
      .filter((entry): entry is StripLink => entry !== null),
  };
}

/** The view's first frame in a strip, or null when the strip does not list it. */
export function frameInStrip(wall: Wall, stripId: string, viewId: string): string | null {
  const strip = wall.strips.find((entry) => entry.id === stripId);
  const frame = strip?.items.find(
    (item): item is Extract<WallItem, { kind: "frame" }> => item.kind === "frame" && item.viewId === viewId,
  );
  return frame ? frame.id : null;
}
