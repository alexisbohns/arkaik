/**
 * The merge behind `arkaik restore`'s default, append mode (#624).
 *
 * A restore used to REPLACE the hosted project with the local bundle, so
 * anything that existed only on the host — an event written in the app, a node
 * an agent added through a token, a weighing score a person entered, a setting
 * like `ref_policy` — was lost unless one of four narrow guards happened to
 * catch it (#348, #393, #423). Append inverts that: the outbound bundle is the
 * hosted export with the local bundle laid over it, so the PUT can only add and
 * update, never remove.
 *
 * The rule per part, local meaning "the bundle this repo is sending":
 *
 *  - **journal** — union by event `id`. An event both sides hold keeps the
 *    hosted copy: the journal is append-only, so the same id is the same event,
 *    and the host's copy is the one already on record. An event without a
 *    string id cannot be matched and is kept from whichever side carried it.
 *    The result is ordered by `ts` (stable, so equal times keep hosted-then-
 *    local order; an unparseable time sorts last) — folds read the journal in
 *    order, and a mined event older than the host's would otherwise land after
 *    them.
 *  - **nodes, edges** — union by `id`; on a shared id the LOCAL record wins.
 *    Landing the local map is what a restore is for, and neither record carries
 *    a time to compare. Local order first, then hosted-only records.
 *  - **project** — the local fields win, and `project.metadata` is merged one
 *    level deep the same way, so a setting only the host has (products, maps,
 *    `ref_policy`, `pollen`, …) survives.
 *  - **quality** — the local section wins when there is one (it is a projection
 *    of the repo's `docs/quality/` sidecars); otherwise the hosted one is kept.
 *    Quality writes made on the host are journal events, which the union keeps.
 *  - **weighing** — merged row by row: sets and matrices by `id` (local wins),
 *    assessments by `assessmentKey` (matrix × subject × criterion × scorer
 *    kind), the later `ts` winning and a tie going to local. A score recorded
 *    on the host is also a journal event, so it survives twice over.
 *  - every other top-level key — local wins, hosted-only keys are kept.
 *
 * Pure, no I/O: `runRestore` hands it the export it already fetched.
 */

import { assessmentKey, type WeighingAssessment } from "@arkaik/schema/src/weighing";
import { isQualitySection } from "./kritik-io";

type Rec = Record<string, unknown>;

const isRecord = (value: unknown): value is Rec => typeof value === "object" && value !== null && !Array.isArray(value);
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const idOf = (item: unknown): string | undefined => {
  const id = isRecord(item) ? item.id : undefined;
  return typeof id === "string" ? id : undefined;
};
/** Milliseconds for an ISO time; anything unparseable reads as the latest there is, so it sorts last. */
const sortTime = (ts: unknown): number => {
  const t = typeof ts === "string" ? Date.parse(ts) : NaN;
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
};
/** Milliseconds for an ISO time; anything unparseable reads as the oldest there is, so it never wins. */
const winTime = (ts: unknown): number => {
  const t = typeof ts === "string" ? Date.parse(ts) : NaN;
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
};

/** What the merge kept from the host that the local bundle did not carry — printed so an append says what it saved. */
export interface AppendSummary {
  nodes: number;
  edges: number;
  events: number;
  /** `project.metadata` keys only the host had. */
  metadataKeys: string[];
  /** The hosted quality section was kept because the local bundle sent none. */
  qualityKept: boolean;
  /** Weighing rows (sets, matrices, assessments) only the host had, or the host held the newer copy of. */
  weighingRows: number;
}

/** Union by id: `primary` order first, every `secondary` record whose id it lacks after. Records with no id are kept from both. */
function unionById(primary: unknown[], secondary: unknown[]): { merged: unknown[]; added: number } {
  const seen = new Set<string>();
  for (const item of primary) {
    const id = idOf(item);
    if (id !== undefined) seen.add(id);
  }
  const merged = [...primary];
  let added = 0;
  for (const item of secondary) {
    const id = idOf(item);
    if (id !== undefined && seen.has(id)) continue;
    if (id !== undefined) seen.add(id);
    merged.push(item);
    added++;
  }
  return { merged, added };
}

function mergeJournal(hosted: unknown[], local: unknown[]): { journal: unknown[]; kept: number } {
  // Hosted first, so a shared id keeps the hosted copy.
  const { merged } = unionById(hosted, local);
  const localIds = new Set(local.map(idOf).filter((id): id is string => id !== undefined));
  const kept = hosted.filter((event) => {
    const id = idOf(event);
    return id !== undefined && !localIds.has(id);
  }).length;
  const journal = merged
    .map((event, index) => ({ event, index, t: sortTime(isRecord(event) ? event.ts : undefined) }))
    .sort((a, b) => a.t - b.t || a.index - b.index)
    .map(({ event }) => event);
  return { journal, kept };
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
  return { weighing, kept: sets.added + matrices.added + keptAssessments };
}

/**
 * Lay `local` (the bundle this repo is sending) over `hosted` (the export just
 * fetched). Returns a new bundle; neither input is mutated.
 */
export function mergeForAppend(hosted: Rec, local: Rec): { bundle: Rec; kept: AppendSummary } {
  const bundle: Rec = { ...hosted, ...local };

  const nodes = unionById(asArray(local.nodes), asArray(hosted.nodes));
  const edges = unionById(asArray(local.edges), asArray(hosted.edges));
  bundle.nodes = nodes.merged;
  bundle.edges = edges.merged;

  const journal = mergeJournal(asArray(hosted.journal), asArray(local.journal));
  bundle.journal = journal.journal;

  let metadataKeys: string[] = [];
  if (isRecord(hosted.project) || isRecord(local.project)) {
    const hostedProject = isRecord(hosted.project) ? hosted.project : {};
    const localProject = isRecord(local.project) ? local.project : {};
    const project: Rec = { ...hostedProject, ...localProject };
    const hostedMeta = isRecord(hostedProject.metadata) ? hostedProject.metadata : undefined;
    const localMeta = isRecord(localProject.metadata) ? localProject.metadata : undefined;
    if (hostedMeta !== undefined) {
      metadataKeys = Object.keys(hostedMeta).filter((key) => localMeta === undefined || !(key in localMeta)).sort();
      project.metadata = { ...hostedMeta, ...(localMeta ?? {}) };
    }
    bundle.project = project;
  }

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
      nodes: nodes.added,
      edges: edges.added,
      events: journal.kept,
      metadataKeys,
      qualityKept,
      weighingRows: weighing.kept,
    },
  };
}

/** One line saying what an append kept from the host, or that it kept nothing. */
export function describeAppendSummary(kept: AppendSummary): string {
  const parts: string[] = [];
  const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
  if (kept.nodes > 0) parts.push(n(kept.nodes, "node"));
  if (kept.edges > 0) parts.push(n(kept.edges, "edge"));
  if (kept.events > 0) parts.push(n(kept.events, "journal event"));
  if (kept.metadataKeys.length > 0) parts.push(`project settings (${kept.metadataKeys.join(", ")})`);
  if (kept.qualityKept) parts.push("the quality section");
  if (kept.weighingRows > 0) parts.push(n(kept.weighingRows, "weighing row"));
  if (parts.length === 0) return "Append: the hosted project held nothing your bundle lacks.";
  return `Append: kept what only the hosted project had — ${parts.join(", ")}.`;
}
