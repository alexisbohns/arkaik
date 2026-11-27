/**
 * A project's anatomy, as the projects page shows it on a card: what the graph
 * is made of (species, platforms) and how alive its journal is (events per
 * month, the newest event).
 *
 * It rides on the LISTING (`ProjectSummary.anatomy`) so the page never opens a
 * project to draw its card. Every backend fills it the same way:
 *  - local and seed derive it here, from the snapshot they already hold;
 *  - hosted derives it in SQL (`lib/services/graph/store.ts`
 *    `listProjectAnatomy`) into the same shape.
 *
 * Months are keyed "YYYY-MM", read straight off the event's ISO timestamp (its
 * first seven characters — every `ts` is written as UTC ISO). The reader turns
 * them into bars against ITS today (`lastTwelveMonths`), so a server's clock or
 * time zone never shifts a bar.
 *
 * No runtime imports: the test loader transpiles this file alone.
 */
import type { PlatformId, SpeciesId } from "@arkaik/schema";

export interface ProjectAnatomy {
  /** Node count per species; a species with no node is absent. */
  species: Partial<Record<SpeciesId, number>>;
  /** Nodes carrying each platform; a platform no node carries is absent. */
  platforms: Partial<Record<PlatformId, number>>;
  /** Null when the project has no journal events. */
  journal: null | {
    /** Events per "YYYY-MM" month, for (at least) the last 12 months. */
    months: Record<string, number>;
    /** ISO timestamp of the newest event. */
    lastAt: string;
    total: number;
  };
}

/** "2026-11-27T10:00:00.000Z" → "2026-11". */
export const monthKey = (iso: string): string => iso.slice(0, 7);

/** The anatomy of a graph and its journal. Events without a `ts` are counted in `total` only. */
export function anatomyOf(
  nodes: readonly { species: SpeciesId; platforms?: readonly PlatformId[] | null }[],
  events: readonly { ts?: string | null }[] = [],
): ProjectAnatomy {
  const species: Partial<Record<SpeciesId, number>> = {};
  const platforms: Partial<Record<PlatformId, number>> = {};
  for (const n of nodes) {
    species[n.species] = (species[n.species] ?? 0) + 1;
    for (const p of n.platforms ?? []) platforms[p] = (platforms[p] ?? 0) + 1;
  }
  if (events.length === 0) return { species, platforms, journal: null };
  const months: Record<string, number> = {};
  let lastAt = "";
  for (const e of events) {
    if (!e.ts) continue;
    if (e.ts > lastAt) lastAt = e.ts;
    const m = monthKey(e.ts);
    months[m] = (months[m] ?? 0) + 1;
  }
  return {
    species,
    platforms,
    journal: lastAt ? { months, lastAt, total: events.length } : null,
  };
}

/** Twelve monthly counts, OLDEST first, ending with `now`'s UTC month. */
export function lastTwelveMonths(months: Record<string, number>, now: Date = new Date()): number[] {
  const out: number[] = [];
  for (let back = 11; back >= 0; back--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    out.push(months[d.toISOString().slice(0, 7)] ?? 0);
  }
  return out;
}
