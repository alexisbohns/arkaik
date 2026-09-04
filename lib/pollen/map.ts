// journal → pollen: the arkaik adapter's projection (slice 3).
// Pure — no DB, no network. Every emitted envelope is run through the
// vendored validator; anything it refuses is skipped WITH a reason, so the
// route can log it (ariko umbrella §11: no silent loss) and a test can see it.
import type { JournalEvent, Node } from "@arkaik/schema";
import { validatePollen, type Pollen } from "./contract";

export interface PollenMapConfig {
  /** ariko plant slug — anchors become `plant:<slug>`. */
  plant: string;
}

export interface MappedFeed {
  pollen: Pollen[];
  skipped: { id: string; reason: string }[];
}

const SOURCE = "arkaik";

export function journalToPollen(
  events: readonly JournalEvent[],
  nodes: readonly Pick<Node, "id" | "title">[],
  config: PollenMapConfig,
): MappedFeed {
  const titles = new Map(nodes.map((n) => [n.id, n.title]));
  /** deliverable_id → pollen id of its FIRST occurrence (corrects target). */
  const firstOccurrence = new Map<string, string>();
  const plant = `plant:${config.plant}`;
  const pollen: Pollen[] = [];
  const skipped: { id: string; reason: string }[] = [];

  for (const event of events) {
    const candidate = mapEvent(event, plant, titles, firstOccurrence);
    if (candidate === null) continue; // unmapped family — by design, not an error
    const result = validatePollen(candidate);
    if (!result.ok) {
      skipped.push({ id: String(event.id ?? "?"), reason: result.error });
      continue;
    }
    pollen.push(result.value);
  }
  return { pollen, skipped };
}

function mapEvent(
  event: JournalEvent,
  plant: string,
  titles: Map<string, string>,
  firstOccurrence: Map<string, string>,
): Record<string, unknown> | null {
  const base = { v: 1, id: `arkaik:${event.id}`, at: event.ts, source: SOURCE, anchors: { plant } };

  if (event.type === "deliverable.shipped") {
    const deliverableId = String(event.deliverable_id);
    const note = event.lab_note as
      | { en: { title: string; summary: string }; fr?: { title?: string; summary?: string }; suggested?: Record<string, unknown> }
      | undefined;
    const title =
      note?.fr?.title ? { en: note.en.title, fr: note.fr.title } : note?.en.title ?? (event.title as string);
    const refs: Record<string, unknown>[] = [];
    if (typeof event.url === "string" && event.url) refs.push({ label: "pull request", url: event.url });
    refs.push({ label: "deliverable", ref: deliverableId });
    const first = firstOccurrence.get(deliverableId);
    if (first) refs.push({ label: "corrects", ref: first });
    else firstOccurrence.set(deliverableId, `arkaik:${event.id}`);
    const payload: Record<string, unknown> = {};
    if (typeof event.summary === "string") payload.summary = event.summary;
    if (note?.fr?.summary) payload.summary_fr = note.fr.summary;
    if (note?.suggested) payload.suggested = note.suggested;
    if (Array.isArray(event.node_ids)) payload.node_ids = event.node_ids;
    // WHERE it landed, beside what it moved. A shipped grain that names the
    // nodes but not the platform is half a fact, and it is the same half the
    // changelog card was missing before a deliverable carried a platform at
    // all. Omitted rather than nulled when there is none: a deliverable that
    // spans two platforms is deliberately unscoped, and `platform: null` in a
    // payload is a different claim from saying nothing.
    if (typeof event.platform === "string" && event.platform) payload.platform = event.platform;
    return { ...base, kind: "shipped", title, refs, payload };
  }

  if (event.type === "release.tagged") {
    const platform = typeof event.platform === "string" ? event.platform : undefined;
    const payload: Record<string, unknown> = { version: event.version };
    if (platform) payload.platform = platform;
    if (typeof event.notes === "string") payload.notes = event.notes;
    return {
      ...base,
      kind: "release.tagged",
      title: platform ? `${event.version} released (${platform})` : `${event.version} released`,
      payload,
    };
  }

  if (event.type === "decision.status_changed" && event.to === "approved") {
    const nodeId = String(event.node_id);
    return {
      ...base,
      kind: "decided",
      title: titles.get(nodeId) ?? nodeId,
      refs: [{ label: "decision", ref: nodeId }],
      payload: { from: event.from, to: event.to },
    };
  }

  return null;
}
