/**
 * The merge behind `arkaik restore`'s default, append mode (#624).
 *
 * A restore used to REPLACE the hosted project with the local bundle, so
 * anything that existed only on the host — an event written in the app, a node
 * an agent added through a token, a weighing score a person entered, a setting
 * like `ref_policy` — was lost unless one of four narrow guards happened to
 * catch it (#348, #393, #423). Append inverts that: the outbound bundle is the
 * hosted export with the local bundle laid over it, so the PUT adds and
 * updates and does not remove.
 *
 * The rule per part, local meaning "the bundle this repo is sending":
 *
 *  - **journal** — union by event `id`. An event both sides hold keeps the
 *    hosted copy: the journal is append-only, so the same id is the same event,
 *    and the host's copy is the one already on record. The result is in
 *    `orderEvents` order (by `ts`, then `id`), which is the order the server
 *    stores and folds it in.
 *  - **nodes, edges** — union by `id`; on a shared id the LOCAL record wins.
 *    Landing the local map is what a restore is for, and neither record carries
 *    a time to compare. Local order first, then hosted-only records.
 *    Two exceptions keep the result valid against the server's journal
 *    cross-check, which compares each node's status with its last transition:
 *    when that last `node.status_changed` (project-level) or
 *    `decision.status_changed` is a HOSTED-only event — a status someone set in
 *    the app after the repo last saw the node — the node takes that status.
 *    And when the local `project.id` differs from the hosted one, hosted-only
 *    nodes and edges are re-stamped with the local id, since every record must
 *    carry the bundle's project id.
 *  - **project** — the local fields win, and `project.metadata` is merged key
 *    by key: a key only the host has is kept; on a shared key, two lists of
 *    `{ id }` records (`maps`, `products`) are unioned by id with the local
 *    record winning, two plain objects (`map_display`, `pollen`, …) are merged
 *    one level with the local value winning, and anything else takes the local
 *    value.
 *  - **quality** — the local section wins when there is one (it is a projection
 *    of the repo's `docs/quality/` sidecars); otherwise the hosted one is kept.
 *    Quality writes made on the host are journal events, which the union keeps.
 *  - **weighing** — merged row by row: sets and matrices by `id` (local wins),
 *    assessments by `assessmentKey` (matrix × subject × criterion × scorer
 *    kind), the later `ts` winning and a tie going to local. Scores recorded on
 *    the host are journal events too, and the read fold lets one replace a
 *    stored row only when it is at least as recent, so the later score still
 *    wins on every read. A criteria set is the exception the fold forces: a
 *    stored set has no time, so any hosted `weighing.set.saved` event for that
 *    id would beat the local set on every read. When the local set differs from
 *    what the host reads, the merge appends a `weighing.set.saved` event for it
 *    (actor `arkaik-restore`), so the local set is what reads back.
 *  - every other top-level key — local wins, hosted-only keys are kept.
 *
 * Pure apart from the time and id stamped on such a set event: `runRestore`
 * hands it the export it already fetched.
 */

import { makeEvent } from "@arkaik/schema/src/emit";
import { orderEvents, type JournalEvent } from "@arkaik/schema/src/journal";
import { WEIGHING_SET_SAVED, assessmentKey, type WeighingAssessment, type WeighingSection } from "@arkaik/schema/src/weighing";
import { foldWeighingEvents } from "@arkaik/schema/src/weighing-events";
import { isQualitySection } from "./kritik-io";

type Rec = Record<string, unknown>;

/** The actor stamped on an event the merge itself writes. */
export const RESTORE_ACTOR = "arkaik-restore";

const isRecord = (value: unknown): value is Rec => typeof value === "object" && value !== null && !Array.isArray(value);
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);
const idOf = (item: unknown): string | undefined => (isRecord(item) ? str(item.id) : undefined);
/** Milliseconds for an ISO time; anything unparseable reads as the oldest there is, so it never wins. */
const winTime = (ts: unknown): number => {
  const t = typeof ts === "string" ? Date.parse(ts) : NaN;
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
};
/** Key-order-insensitive equality for plain JSON values. */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => sameJson(item, b[i]));
  }
  if (!isRecord(a) || !isRecord(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => key in b && sameJson(a[key], b[key]));
}

/** What the merge kept from the host that the local bundle did not carry — printed so an append says what it saved. */
export interface AppendSummary {
  nodes: number;
  edges: number;
  events: number;
  /** `project.metadata` keys where something only the host had was kept (a whole key, or entries inside one). */
  metadataKeys: string[];
  /** Nodes whose status (or decision status) was taken from a transition made on the host after the repo's copy. */
  statuses: string[];
  /** The hosted quality section was kept because the local bundle sent none. */
  qualityKept: boolean;
  /** Weighing rows (sets, matrices, assessments) only the host had, or the host held the newer copy of. */
  weighingRows: number;
  /** Criteria sets the merge wrote a `weighing.set.saved` event for, so the local set wins on read. */
  setsResaved: string[];
}

/** Union by id: `primary` order first, every `secondary` record whose id it lacks after. Records with no id are kept from both. */
function unionById(primary: unknown[], secondary: unknown[]): { merged: unknown[]; added: unknown[] } {
  const seen = new Set<string>();
  for (const item of primary) {
    const id = idOf(item);
    if (id !== undefined) seen.add(id);
  }
  const merged = [...primary];
  const added: unknown[] = [];
  for (const item of secondary) {
    const id = idOf(item);
    if (id !== undefined && seen.has(id)) continue;
    if (id !== undefined) seen.add(id);
    merged.push(item);
    added.push(item);
  }
  return { merged, added };
}

const isIdList = (value: unknown): value is unknown[] => Array.isArray(value) && value.every((item) => idOf(item) !== undefined);

function mergeMetadata(hosted: Rec, local: Rec): { metadata: Rec; kept: string[] } {
  const metadata: Rec = { ...hosted, ...local };
  const kept: string[] = [];
  for (const key of Object.keys(hosted)) {
    if (!(key in local)) {
      kept.push(key);
      continue;
    }
    const h = hosted[key];
    const l = local[key];
    if (isIdList(h) && isIdList(l)) {
      const union = unionById(l, h);
      metadata[key] = union.merged;
      if (union.added.length > 0) kept.push(key);
    } else if (isRecord(h) && isRecord(l)) {
      metadata[key] = { ...h, ...l };
      if (Object.keys(h).some((inner) => !(inner in l))) kept.push(key);
    }
  }
  return { metadata, kept: kept.sort() };
}

/**
 * Take a hosted status where the node's last transition is a hosted-only event,
 * so the snapshot agrees with the journal it ships with. Returns the ids changed.
 */
function reconcileStatuses(nodes: unknown[], journal: readonly unknown[], localEventIds: ReadonlySet<string>): string[] {
  const lastStatus = new Map<string, Rec>();
  const lastDecision = new Map<string, Rec>();
  for (const event of journal) {
    if (!isRecord(event)) continue;
    const nodeId = str(event.node_id);
    if (nodeId === undefined || str(event.to) === undefined) continue;
    if (event.type === "node.status_changed" && event.platform === undefined) lastStatus.set(nodeId, event);
    else if (event.type === "decision.status_changed") lastDecision.set(nodeId, event);
  }
  const hostedOnly = (event: Rec | undefined): event is Rec => {
    const id = event === undefined ? undefined : str(event.id);
    return id !== undefined && !localEventIds.has(id);
  };
  const changed = new Set<string>();
  nodes.forEach((node, index) => {
    const id = idOf(node);
    if (id === undefined || !isRecord(node)) return;
    let next: Rec = node;
    const status = lastStatus.get(id);
    if (hostedOnly(status) && next.status !== status.to) next = { ...next, status: status.to };
    const decision = lastDecision.get(id);
    if (hostedOnly(decision)) {
      const metadata = isRecord(next.metadata) ? next.metadata : {};
      if (metadata.decision_status !== decision.to) next = { ...next, metadata: { ...metadata, decision_status: decision.to } };
    }
    if (next !== node) {
      nodes[index] = next;
      changed.add(id);
    }
  });
  return [...changed].sort();
}

function mergeWeighing(hosted: unknown, local: unknown): { weighing: Rec | undefined; kept: number } {
  if (!isRecord(hosted)) return { weighing: isRecord(local) ? local : undefined, kept: 0 };
  if (!isRecord(local)) {
    const kept = asArray(hosted.sets).length + asArray(hosted.matrices).length + asArray(hosted.assessments).length;
    return { weighing: hosted, kept };
  }
  const sets = unionById(asArray(local.sets), asArray(hosted.sets));
  const matrices = unionById(asArray(local.matrices), asArray(hosted.matrices));

  const assessments = [...asArray(local.assessments)];
  let keptAssessments = 0;
  const keyOf = (row: unknown): string | undefined =>
    isRecord(row) ? assessmentKey(row as unknown as WeighingAssessment) : undefined;
  for (const row of asArray(hosted.assessments)) {
    const key = keyOf(row);
    const at = key === undefined ? -1 : assessments.findIndex((existing) => keyOf(existing) === key);
    if (at === -1) {
      assessments.push(row);
      keptAssessments++;
    } else if (winTime((row as Rec).ts) > winTime((assessments[at] as Rec).ts)) {
      assessments[at] = row;
      keptAssessments++;
    }
  }

  const weighing: Rec = { ...hosted, ...local };
  if (sets.merged.length > 0 || "sets" in local || "sets" in hosted) weighing.sets = sets.merged;
  if (matrices.merged.length > 0 || "matrices" in local || "matrices" in hosted) weighing.matrices = matrices.merged;
  if (assessments.length > 0 || "assessments" in local || "assessments" in hosted) weighing.assessments = assessments;
  return { weighing, kept: sets.added.length + matrices.added.length + keptAssessments };
}

/**
 * The `weighing.set.saved` events that make each local set win on read: one per
 * local set the hosted journal has saved under the same id and whose hosted
 * reading differs. Throws (from the event schema) on a set that is not shaped
 * right, which the caller turns into a refusal.
 */
function resaveLocalSets(hostedWeighing: unknown, hostedJournal: readonly unknown[], localWeighing: unknown, now: Date): JournalEvent[] {
  if (!isRecord(localWeighing)) return [];
  const savedOnHost = new Set<string>();
  for (const event of hostedJournal) {
    if (isRecord(event) && event.type === WEIGHING_SET_SAVED && isRecord(event.set)) {
      const id = str(event.set.id);
      if (id !== undefined) savedOnHost.add(id);
    }
  }
  if (savedOnHost.size === 0) return [];
  const hostedReading = foldWeighingEvents(
    isRecord(hostedWeighing) ? (hostedWeighing as WeighingSection) : undefined,
    hostedJournal.filter(isRecord) as JournalEvent[],
  );
  const events: JournalEvent[] = [];
  for (const set of asArray(localWeighing.sets)) {
    const id = idOf(set);
    if (id === undefined || !savedOnHost.has(id)) continue;
    const onHost = asArray(hostedReading?.sets).find((existing) => idOf(existing) === id);
    if (sameJson(onHost, set)) continue;
    events.push(makeEvent(WEIGHING_SET_SAVED, { set }, { actor: RESTORE_ACTOR, ts: now }));
  }
  return events;
}

/**
 * Lay `local` (the bundle this repo is sending) over `hosted` (the export just
 * fetched). Returns a new bundle; neither input is mutated. Throws only when a
 * local criteria set that has to be re-saved fails the event schema.
 */
export function mergeForAppend(hosted: Rec, local: Rec, now: Date = new Date()): { bundle: Rec; kept: AppendSummary } {
  const bundle: Rec = { ...hosted, ...local };

  // Project first: its id decides what the hosted-only records must carry.
  let metadataKeys: string[] = [];
  if (isRecord(hosted.project) || isRecord(local.project)) {
    const hostedProject = isRecord(hosted.project) ? hosted.project : {};
    const localProject = isRecord(local.project) ? local.project : {};
    const project: Rec = { ...hostedProject, ...localProject };
    if (isRecord(hostedProject.metadata)) {
      const merged = mergeMetadata(hostedProject.metadata, isRecord(localProject.metadata) ? localProject.metadata : {});
      project.metadata = merged.metadata;
      metadataKeys = merged.kept;
    }
    bundle.project = project;
  }
  const localProjectId = isRecord(local.project) ? str(local.project.id) : undefined;
  const hostedProjectId = isRecord(hosted.project) ? str(hosted.project.id) : undefined;
  const restamp = (item: unknown): unknown =>
    localProjectId !== undefined && localProjectId !== hostedProjectId && isRecord(item) && item.project_id === hostedProjectId
      ? { ...item, project_id: localProjectId }
      : item;

  const nodes = unionById(asArray(local.nodes), asArray(hosted.nodes).map(restamp));
  const edges = unionById(asArray(local.edges), asArray(hosted.edges).map(restamp));

  const hostedJournal = asArray(hosted.journal);
  const localJournal = asArray(local.journal);
  const localEventIds = new Set(localJournal.map(idOf).filter((id): id is string => id !== undefined));
  const hostedEventIds = new Set(hostedJournal.map(idOf).filter((id): id is string => id !== undefined));
  const resaved = resaveLocalSets(hosted.weighing, hostedJournal, local.weighing, now);
  // Hosted first, so a shared id keeps the hosted copy.
  const journal = orderEvents(unionById([...hostedJournal, ...resaved], localJournal).merged as Array<{ ts?: unknown; id?: unknown }>);
  bundle.journal = journal;
  const eventsKept = [...hostedEventIds].filter((id) => !localEventIds.has(id)).length;

  // The resaved events are the merge's own, so they count as local here: a set
  // event never moves a node status, and the reconcile only reads status events.
  const statuses = reconcileStatuses(nodes.merged, journal, localEventIds);
  bundle.nodes = nodes.merged;
  bundle.edges = edges.merged;

  let qualityKept = false;
  if (isQualitySection(local.quality)) bundle.quality = local.quality;
  else if (isQualitySection(hosted.quality)) {
    bundle.quality = hosted.quality;
    qualityKept = true;
  } else delete bundle.quality;

  const weighing = mergeWeighing(hosted.weighing, local.weighing);
  if (weighing.weighing === undefined) delete bundle.weighing;
  else bundle.weighing = weighing.weighing;

  return {
    bundle,
    kept: {
      nodes: nodes.added.length,
      edges: edges.added.length,
      events: eventsKept,
      metadataKeys,
      statuses,
      qualityKept,
      weighingRows: weighing.kept,
      setsResaved: resaved.map((event) => String((event.set as Rec).id)),
    },
  };
}

/** The lines saying what an append kept from the host, or that it kept nothing. */
export function describeAppendSummary(kept: AppendSummary): string {
  const parts: string[] = [];
  const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
  if (kept.nodes > 0) parts.push(n(kept.nodes, "node"));
  if (kept.edges > 0) parts.push(n(kept.edges, "edge"));
  if (kept.events > 0) parts.push(n(kept.events, "journal event"));
  if (kept.metadataKeys.length > 0) parts.push(`project settings (${kept.metadataKeys.join(", ")})`);
  if (kept.qualityKept) parts.push("the quality section");
  if (kept.weighingRows > 0) parts.push(n(kept.weighingRows, "weighing row"));
  const lines = [
    parts.length === 0
      ? "Append: the hosted project held nothing your bundle lacks."
      : `Append: kept what only the hosted project had — ${parts.join(", ")}.`,
  ];
  if (kept.statuses.length > 0) {
    lines.push(`  Took the hosted status of ${kept.statuses.join(", ")}: it was changed on the hosted project after your copy.`);
  }
  if (kept.setsResaved.length > 0) {
    lines.push(`  Re-saved criteria set ${kept.setsResaved.join(", ")} from your bundle, so it replaces the hosted version.`);
  }
  return lines.join("\n");
}
