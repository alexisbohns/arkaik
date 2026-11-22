/**
 * The proof reader — what a stake has, and where it stands, derived and never
 * stored (docs/rfcs/stake-architecture.md § 8 and § 14,
 * docs/superpowers/specs/2026-11-22-stake-architecture-parts-5-6-design.md,
 * part D).
 *
 * A stake's proof has two halves. **Verified**: the definition of done passes
 * (an acceptance at `releasing` or `live`, or, for a requirement, a Kritik
 * pass). **Delivered**: the answer is in people's hands (an acceptance at
 * `live`). Each species declares which halves it needs. The halves are read on
 * every platform the answer concerns, and a ladder of six states is derived
 * from them: raised, considered, promised, verified-not-delivered,
 * partly-addressed, addressed.
 *
 * Everything is read from facts that already exist: the nodes and edges, the
 * journal events of {@link PROOF_EVENT_TYPES}, the quality section for findings
 * and scores, the weighing section for "considered", and the Kritik library for
 * a criterion's version. Nothing is written. `now` is always an argument, so a
 * read is a function of its inputs and testable.
 *
 * Lenient and total, like {@link ./weighing-derive}: an unknown value, a
 * malformed event or an unparseable date degrades to "not known" and never
 * throws. Minimal `Pick<>` inputs, nothing mutated. Deliberately zod-free and
 * fs-free (value imports only from zod-free modules; the rest are types), so it
 * runs in the browser, in the MCP server and in a test loader alike.
 *
 * Design calls the spec left open, taken here:
 *
 * - A requirement is "promised" through its criterion: a decision chose an
 *   option and the stake names a Kritik criterion (its definition of done). An
 *   acceptance that addresses the requirement directly and reads as a promise
 *   counts too, and its delivery is read separately, never required.
 * - A stale cell contributes nothing to *partly addressed*: a stale verification
 *   lands in *promised* whatever was delivered (call 5). A platform whose check
 *   is fresh still counts, so one stale platform among fresh ones reads partly
 *   addressed.
 * - A requirement's delivery is optional and read separately: when it is
 *   delivered but not verified, the ladder files it under partly addressed (the
 *   note under call 5). A risk's delivery is not required and does not count.
 * - A stake with no usable kind reads as needing both halves, the strictest
 *   reading, so a stake is never called addressed on less than it may need.
 * - A requirement whose stake names no anchor is blocked by any open finding of
 *   its criterion: nothing narrows the finding to a place.
 */

import { resolvePlatformStatus } from "./acceptance";
import type { Edge, Node, NodeMetadata, Project } from "./bundle";
import { PLATFORM_IDS, type PlatformId } from "./ids";
import { orderEvents, type JournalEvent } from "./journal";
import { normalizeStatus } from "./legacy-status";
import {
  acceptancesAddressing,
  answerFor,
  answerTypeForStake,
  candidatesFor,
  isPromise,
  optionsAddressing,
  promisesOf,
  type AnswerTypeId,
} from "./option";
import { effectiveNodePlatforms, productOf, resolveProducts, type ProductDefinition } from "./products";
import { isOpenFinding, type KritikLibrary, type QualityFinding, type QualitySection } from "./quality";
import { DEFAULT_TARGET_LEVEL } from "./quality-ops";
import {
  QUALITY_STAKE_SPECIES,
  USER_FACING_STAKE_SPECIES,
  stakeCatalogOf,
  stakeEvidenceOf,
  stakeMattersOf,
  stakeReverifyDaysOf,
  stakeSpeciesOf,
  stakeVerifiedCriterionVersionOf,
  type StakeSpeciesId,
} from "./stake";
import { kritikCriterionVersion } from "./stake-evaluation";
import type { WeighingSection } from "./weighing";

/**
 * The journal event types the proof reads, shared by every consumer so they ask
 * one query: the app projects its journal read to these, the MCP tool and the
 * CLI filter to them. `node.created` dates a stake for the requirement's pass;
 * `node.status_changed` dates the check behind an acceptance; the three
 * `quality.finding.*` types and `quality.assessment.scored` carry a requirement's
 * findings and scores. `decision.status_changed` is part of the query so a
 * consumer reads a decision's moves in the same pass, though the rules below
 * read a decision's current status off its node.
 */
export const PROOF_EVENT_TYPES = [
  "node.created",
  "node.status_changed",
  "decision.status_changed",
  "quality.finding.opened",
  "quality.finding.resolved",
  "quality.finding.accepted",
  "quality.assessment.scored",
] as const;
export type ProofEventType = (typeof PROOF_EVENT_TYPES)[number];

/** The six derived states of a stake, lowest first (RFC § 8). Never stored. */
export const STAKE_STATES = ["raised", "considered", "promised", "verified-not-delivered", "partly-addressed", "addressed"] as const;
export type StakeStateId = (typeof STAKE_STATES)[number];

/** Whether a species needs delivery: a requirement and a defect report it, a risk does not need it. */
export type ProofDelivery = "required" | "optional" | "not-required";

/** One platform's reading, or the single platform-less reading of a requirement. */
export interface ProofCell {
  platform: PlatformId | null;
  /** The verified half holds here and has not lapsed. */
  verified: boolean;
  /** The answer is `live` here. */
  delivered: boolean;
  /** The verified half held but its interval has run out, or the criterion moved to a newer version. */
  stale: boolean;
  /** The date of the latest check this cell's verified half rests on, when one is dated. */
  checked_at?: string;
}

export interface StakeProof {
  stake_id: string;
  stake_species?: StakeSpeciesId;
  answer_type?: AnswerTypeId;
  /** `null` for an archived stake: it derives no state (call 11). */
  state: StakeStateId | null;
  /** The decision that settled the stake and the option it chose. */
  answer?: { decision_id: string; option_id: string };
  /** Acceptance ids; empty for a requirement, whose definition of done is its Kritik criterion. */
  definition_of_done: string[];
  delivery: ProofDelivery;
  /** One per platform concerned; one platform-less cell for a requirement or when no platform resolves. */
  cells: ProofCell[];
  /** Why the state is what it is, in words. */
  reasons: string[];
}

type ProofNode = Pick<Node, "id" | "species" | "status" | "platforms" | "metadata"> & Partial<Pick<Node, "title">>;
type ProofEdge = Pick<Edge, "source_id" | "target_id" | "edge_type">;

export interface StakeProofsInput {
  nodes: readonly ProofNode[];
  edges: readonly ProofEdge[];
  /** Any journal events; the reader keeps {@link PROOF_EVENT_TYPES} and ignores the rest. */
  events?: readonly unknown[];
  /** The clock. A Date, an ISO string or milliseconds; one that does not parse expires nothing. */
  now: Date | string | number;
  /** For the products' platform menus. */
  project?: Pick<Project, "metadata"> | null;
  /** The active product scope; `null` or absent reads under All products. */
  productId?: string | null;
  /** The Kritik library, for a criterion's version. */
  library?: Pick<KritikLibrary, "criteria"> | null;
  /** The findings and scores stored in the bundle. */
  quality?: Pick<QualitySection, "assessments" | "findings"> | Partial<Pick<QualitySection, "assessments" | "findings">> | null;
  /** The weighing section, for "considered" on the user-facing kinds. */
  weighing?: Pick<WeighingSection, "assessments"> | null;
}

export interface StakeProofInput extends StakeProofsInput {
  stakeId: string;
}

const DAY_MS = 86_400_000;
const VERIFIED_STATUSES: readonly string[] = ["releasing", "live"];
const DELIVERED_STATUSES: readonly string[] = ["live"];

// --- Small lenient helpers ---------------------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const asString = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined);

/** A timestamp in milliseconds, or undefined when it is not a string that parses. */
function timeMs(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

function nowMsOf(now: unknown): number | undefined {
  if (now instanceof Date) return Number.isFinite(now.getTime()) ? now.getTime() : undefined;
  if (typeof now === "number") return Number.isFinite(now) ? now : undefined;
  return timeMs(now);
}

const isoOf = (ms: number): string => new Date(ms).toISOString();

/** The proof events, in time order. Anything that is not an event of a proof type is dropped. */
export function proofEventsOf(events: readonly unknown[] | null | undefined): JournalEvent[] {
  if (!Array.isArray(events)) return [];
  const kept = events.filter((event): event is JournalEvent => isRecord(event) && (PROOF_EVENT_TYPES as readonly string[]).includes(event.type as string));
  return orderEvents(kept);
}

/** A node the reader can take for granted: an object with a string id, an array of platforms and a metadata object. */
function sanitizeNode(raw: unknown): ProofNode | undefined {
  if (!isRecord(raw) || typeof raw.id !== "string") return undefined;
  const node = raw as unknown as ProofNode;
  const metadata = isRecord(node.metadata) ? node.metadata : undefined;
  if (Array.isArray(node.platforms) && metadata === node.metadata) return node;
  return { ...node, platforms: Array.isArray(node.platforms) ? node.platforms : [], metadata: metadata as NodeMetadata | undefined };
}

const sanitizeEdge = (raw: unknown): raw is ProofEdge =>
  isRecord(raw) && typeof raw.source_id === "string" && typeof raw.target_id === "string" && typeof raw.edge_type === "string";

function deliveryFor(species: StakeSpeciesId | undefined): ProofDelivery {
  if (species === "requirement" || species === "defect") return "optional";
  if (species === "risk") return "not-required";
  return "required";
}

// --- What the journal says about status moves --------------------------------

interface StatusCheck {
  ms: number;
  /** The platform the move names, or undefined for a move of the node's own status. */
  platform: PlatformId | undefined;
}

/** `node_id -> the moves into releasing or live`, the checks an acceptance's verification rests on. */
function statusChecksByNode(events: readonly JournalEvent[]): Map<string, StatusCheck[]> {
  const checks = new Map<string, StatusCheck[]>();
  for (const event of events) {
    if (event.type !== "node.status_changed") continue;
    const nodeId = asString(event.node_id);
    const to = typeof event.to === "string" ? normalizeStatus(event.to) : undefined;
    const ms = timeMs(event.ts);
    if (nodeId === undefined || to === undefined || ms === undefined || !VERIFIED_STATUSES.includes(to)) continue;
    const named = event.platform;
    const platform = typeof named === "string" && (PLATFORM_IDS as readonly string[]).includes(named) ? (named as PlatformId) : undefined;
    // A move that names a platform this build does not know is a platform nobody here can read: it is no check at all.
    if (named !== undefined && platform === undefined) continue;
    const list = checks.get(nodeId) ?? [];
    list.push({ ms, platform });
    checks.set(nodeId, list);
  }
  return checks;
}

// --- The Kritik pass of a requirement ----------------------------------------

interface KritikReading {
  /** Whether the pass holds: no open finding at the anchor, and a fresh score at the target on every scored surface. */
  holds: boolean;
  /** The latest score or finding closure on the criterion, in ms. */
  checkedMs: number | undefined;
  reasons: string[];
}

interface FindingFact {
  open: boolean;
  nodeIds: string[];
  closedMs: number | undefined;
}

/**
 * The state of every finding of one criterion. A finding the stored section
 * holds takes the section's status (it is the folded truth); a finding only the
 * journal knows is replayed: opened, then resolved or accepted, reopened by a
 * later opened. A resolved or accepted event carries no criterion, so it joins
 * to its opened event by finding id; a close that joins to nothing is ignored.
 */
function findingFacts(criterionId: string, section: StakeProofsInput["quality"], events: readonly JournalEvent[]): FindingFact[] {
  const stored = new Map<string, Record<string, unknown>>();
  const storedFindings = isRecord(section) && Array.isArray(section.findings) ? section.findings : [];
  for (const finding of storedFindings as unknown[]) {
    if (isRecord(finding) && typeof finding.id === "string") stored.set(finding.id, finding);
  }

  const replay = new Map<string, { criterion?: string; nodeIds: string[]; open: boolean; closedMs: number | undefined }>();
  const nodeIdsOf = (raw: unknown): string[] => (Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : []);
  for (const event of events) {
    const findingId = asString(event.finding_id);
    if (findingId === undefined) continue;
    if (event.type === "quality.finding.opened") {
      const row = replay.get(findingId) ?? { nodeIds: [], open: true, closedMs: undefined };
      row.criterion = asString(event.criterion_id) ?? row.criterion;
      row.nodeIds = nodeIdsOf(event.node_ids).length > 0 ? nodeIdsOf(event.node_ids) : row.nodeIds;
      row.open = true;
      row.closedMs = undefined;
      replay.set(findingId, row);
    } else if (event.type === "quality.finding.resolved" || event.type === "quality.finding.accepted") {
      const row = replay.get(findingId) ?? { nodeIds: [], open: false, closedMs: undefined };
      row.open = false;
      row.closedMs = timeMs(event.ts);
      if (row.nodeIds.length === 0) row.nodeIds = nodeIdsOf(event.node_ids);
      replay.set(findingId, row);
    }
  }

  const facts: FindingFact[] = [];
  for (const id of new Set([...stored.keys(), ...replay.keys()])) {
    const row = stored.get(id);
    const replayed = replay.get(id);
    const criterion = row !== undefined ? asString(row.criterion_id) : replayed?.criterion;
    if (criterion !== criterionId) continue;
    const storedNodeIds = row !== undefined ? nodeIdsOf(row.node_ids) : [];
    facts.push({
      open: row !== undefined ? isOpenFinding(row as Pick<QualityFinding, "status">) : (replayed?.open ?? false),
      nodeIds: storedNodeIds.length > 0 ? storedNodeIds : (replayed?.nodeIds ?? []),
      closedMs: replayed?.closedMs,
    });
  }
  return facts;
}

interface Score {
  surface: string;
  level: number;
  ms: number;
}

/** Every score of one criterion, from the stored assessments and from `quality.assessment.scored` events. A score without a whole level 0 to 4 or a date is skipped. */
function scoresOf(criterionId: string, section: StakeProofsInput["quality"], events: readonly JournalEvent[]): Score[] {
  const scores: Score[] = [];
  const add = (row: Record<string, unknown>, ts: unknown) => {
    const ms = timeMs(ts);
    const level = row.level;
    if (asString(row.criterion_id) !== criterionId || ms === undefined) return;
    if (typeof level !== "number" || !Number.isInteger(level) || level < 0 || level > 4) return;
    scores.push({ surface: typeof row.surface === "string" ? row.surface : "", level, ms });
  };
  const assessments = isRecord(section) && Array.isArray(section.assessments) ? section.assessments : [];
  for (const row of assessments as unknown[]) if (isRecord(row)) add(row, row.ts);
  for (const event of events) if (event.type === "quality.assessment.scored") add(event, event.ts);
  return scores;
}

/** When the stake was raised: its `node.created`, else its earliest evidence date, else unknown. */
function raisedMsOf(stake: ProofNode, events: readonly JournalEvent[]): number | undefined {
  const created = events
    .filter((event) => event.type === "node.created" && event.node_id === stake.id)
    .map((event) => timeMs(event.ts))
    .filter((ms): ms is number => ms !== undefined);
  if (created.length > 0) return Math.min(...created);
  const dated = stakeEvidenceOf(stake)
    .map((entry) => timeMs(entry.date))
    .filter((ms): ms is number => ms !== undefined);
  return dated.length > 0 ? Math.min(...dated) : undefined;
}

/**
 * A requirement's Kritik pass (call 7): no open finding of the criterion at the
 * stake's anchor, and at least one score of the criterion dated after the stake
 * was raised with the latest such score on every surface at or above the target
 * level. A finding elsewhere does not block; a score before the stake was raised
 * is ignored.
 */
function kritikReading(
  stake: ProofNode,
  criterionId: string,
  anchors: readonly string[],
  quality: StakeProofsInput["quality"],
  events: readonly JournalEvent[],
): KritikReading {
  const reasons: string[] = [];
  const atAnchor = (nodeIds: readonly string[]) => anchors.length === 0 || nodeIds.some((id) => anchors.includes(id));
  const facts = findingFacts(criterionId, quality, events).filter((fact) => atAnchor(fact.nodeIds));
  const blocking = facts.filter((fact) => fact.open).length;
  if (blocking > 0) reasons.push(`${blocking} open ${criterionId} finding${blocking === 1 ? "" : "s"} at the stake's anchor.`);

  const raisedMs = raisedMsOf(stake, events);
  const counted = scoresOf(criterionId, quality, events).filter((score) => raisedMs === undefined || score.ms > raisedMs);
  const latest = new Map<string, Score>();
  for (const score of counted) {
    const current = latest.get(score.surface);
    if (current === undefined || score.ms > current.ms || (score.ms === current.ms && score.level < current.level)) latest.set(score.surface, score);
  }
  let scoresPass = latest.size > 0;
  if (latest.size === 0) {
    reasons.push(`No ${criterionId} score dated after the stake was raised.`);
  } else {
    const below = [...latest.entries()].filter(([, score]) => score.level < DEFAULT_TARGET_LEVEL);
    if (below.length > 0) {
      scoresPass = false;
      reasons.push(`${criterionId} is below level ${DEFAULT_TARGET_LEVEL} on ${below.map(([surface]) => surface || "a surface").join(", ")}.`);
    }
  }

  const checks = [...counted.map((score) => score.ms), ...facts.filter((fact) => !fact.open && fact.closedMs !== undefined).map((fact) => fact.closedMs as number)];
  return { holds: blocking === 0 && scoresPass, checkedMs: checks.length > 0 ? Math.max(...checks) : undefined, reasons };
}

// --- The reader --------------------------------------------------------------

interface Prepared {
  nodes: ProofNode[];
  edges: ProofEdge[];
  events: JournalEvent[];
  statusChecks: Map<string, StatusCheck[]>;
  products: ProductDefinition[];
  scopeProduct: ProductDefinition | null;
  nowMs: number | undefined;
  input: StakeProofsInput;
}

function prepare(input: StakeProofsInput): Prepared {
  const nodes = (Array.isArray(input.nodes) ? input.nodes : []).map(sanitizeNode).filter((node): node is ProofNode => node !== undefined);
  const edges = (Array.isArray(input.edges) ? input.edges : []).filter(sanitizeEdge);
  const events = proofEventsOf(input.events);
  const products = resolveProducts(input.project);
  const scopeId = typeof input.productId === "string" ? input.productId : null;
  return {
    nodes,
    edges,
    events,
    statusChecks: statusChecksByNode(events),
    products,
    scopeProduct: scopeId === null ? null : (products.find((product) => product.id === scopeId) ?? null),
    nowMs: nowMsOf(input.now),
    input,
  };
}

/**
 * The platforms an acceptance concerns in the active scope: its own product's
 * menu governs when it belongs to one, else the scope's, else its own list. The
 * app's rule (`scopedPlatforms`), so a web-only admin acceptance does not grow a
 * column under All products.
 */
function platformsOf(acceptance: ProofNode, prepared: Prepared): PlatformId[] {
  const ownId = productOf(acceptance);
  const own = ownId === null ? null : (prepared.products.find((product) => product.id === ownId) ?? null);
  return effectiveNodePlatforms(acceptance, own ?? prepared.scopeProduct);
}

/** True when an acceptance reads one of `statuses` on a platform (or on its own status when platform-less), and is not archived. */
function reads(acceptance: ProofNode, platform: PlatformId | null, statuses: readonly string[]): boolean {
  if (acceptance.status === "archived") return false;
  const status = platform === null ? acceptance.status : resolvePlatformStatus(acceptance, platform);
  return status !== undefined && statuses.includes(status);
}

/**
 * The latest check behind an acceptance on a platform: its latest move into
 * releasing or live. A move that names the platform counts for it; a move that
 * names none counts for a platform the acceptance holds no status of its own
 * for. A platform-less cell takes any move.
 */
function latestCheckMs(acceptance: ProofNode, platform: PlatformId | null, prepared: Prepared): number | undefined {
  const hasOwnEntry = platform !== null && isRecord(acceptance.metadata?.platformStatuses) && acceptance.metadata?.platformStatuses?.[platform] !== undefined;
  let latest: number | undefined;
  for (const check of prepared.statusChecks.get(acceptance.id) ?? []) {
    const applies = platform === null || check.platform === platform || (check.platform === undefined && !hasOwnEntry);
    if (applies && (latest === undefined || check.ms > latest)) latest = check.ms;
  }
  return latest;
}

function lapsed(days: number | undefined, checkedMs: number | undefined, nowMs: number | undefined): boolean {
  if (days === undefined || nowMs === undefined) return false;
  return checkedMs === undefined || nowMs - checkedMs > days * DAY_MS;
}

/** True when every acceptance is delivered (live) on every platform it concerns, and there is at least one. */
function deliveredEverywhere(acceptances: readonly ProofNode[], prepared: Prepared): boolean {
  if (acceptances.length === 0) return false;
  return acceptances.every((acceptance) => {
    const platforms = platformsOf(acceptance, prepared);
    return platforms.length === 0 ? reads(acceptance, null, DELIVERED_STATUSES) : platforms.every((platform) => reads(acceptance, platform, DELIVERED_STATUSES));
  });
}

function proofFor(prepared: Prepared, stake: ProofNode): StakeProof {
  const { nodes, edges, events, nowMs } = prepared;
  const species = stakeSpeciesOf(stake);
  const answerType = answerTypeForStake(stake);
  const delivery = deliveryFor(species);
  const isRequirement = species === "requirement";
  const userFacing = species !== undefined && (USER_FACING_STAKE_SPECIES as readonly string[]).includes(species);
  const quality = species !== undefined && (QUALITY_STAKE_SPECIES as readonly string[]).includes(species);
  const reverifyDays = stakeReverifyDaysOf(stake);
  const reasons: string[] = [];

  const answerNodes = answerFor(stake.id, nodes, edges);
  const answer = answerNodes === undefined ? undefined : { decision_id: answerNodes.decision.id, option_id: answerNodes.option.id };
  if (answerNodes !== undefined && answerNodes.competing.length > 0) {
    reasons.push(`More than one decision settles this stake (${[answerNodes.decision.id, ...answerNodes.competing].join(", ")}): the latest, ${answerNodes.decision.id}, is read.`);
  }
  const directPromises = acceptancesAddressing(stake.id, nodes, edges).filter((acceptance) => isPromise(acceptance, nodes, edges));
  const promises = promisesOf(stake.id, nodes, edges);
  const catalog = stakeCatalogOf(stake);
  const criterionId = catalog?.source === "kritik" ? catalog.id : undefined;

  // The definition of done: the promised acceptances, or for a requirement its Kritik criterion.
  const dod = isRequirement ? [] : promises;
  const hasDod = isRequirement ? criterionId !== undefined : dod.length > 0;

  // The cells.
  const cells: ProofCell[] = [];
  if (isRequirement) {
    const anchors = edges.filter((edge) => edge.edge_type === "concerns" && edge.source_id === stake.id).map((edge) => edge.target_id);
    let holds = false;
    let checkedMs: number | undefined;
    if (criterionId === undefined) {
      reasons.push("The requirement names no Kritik criterion, so nothing can be checked.");
    } else {
      const reading = kritikReading(stake, criterionId, anchors, prepared.input.quality, events);
      holds = reading.holds;
      checkedMs = reading.checkedMs;
      reasons.push(...reading.reasons);
    }
    const storedVersion = stakeVerifiedCriterionVersionOf(stake);
    const currentVersion = criterionId === undefined ? undefined : kritikCriterionVersion(criterionId, prepared.input.library);
    const newerVersion = storedVersion !== undefined && currentVersion !== undefined && currentVersion > storedVersion;
    const expired = holds && lapsed(reverifyDays, checkedMs, nowMs);
    const stale = holds && (expired || newerVersion);
    if (holds && newerVersion) reasons.push(`${criterionId} is at version ${currentVersion}, newer than version ${storedVersion} this was verified against.`);
    if (expired) reasons.push(checkedMs === undefined ? "The check has no date, and the stake expires." : `The latest check is older than ${reverifyDays} days.`);
    cells.push({
      platform: null,
      verified: holds && !stale,
      delivered: deliveredEverywhere(promises, prepared),
      stale,
      ...(checkedMs !== undefined ? { checked_at: isoOf(checkedMs) } : {}),
    });
  } else {
    const platforms = PLATFORM_IDS.filter((platform) => dod.some((acceptance) => platformsOf(acceptance, prepared).includes(platform)));
    const targets: (PlatformId | null)[] = platforms.length > 0 ? platforms : [null];
    for (const platform of targets) {
      const applying = platform === null ? dod : dod.filter((acceptance) => platformsOf(acceptance, prepared).includes(platform));
      const holds = applying.length > 0 && applying.every((acceptance) => reads(acceptance, platform, VERIFIED_STATUSES));
      const delivered = applying.length > 0 && applying.every((acceptance) => reads(acceptance, platform, DELIVERED_STATUSES));
      const checks = applying.map((acceptance) => latestCheckMs(acceptance, platform, prepared));
      const checkedMs = checks.every((ms): ms is number => ms !== undefined) && checks.length > 0 ? Math.min(...(checks as number[])) : undefined;
      const stale = holds && lapsed(reverifyDays, checkedMs, nowMs);
      if (stale) reasons.push(`${platform ?? "The"} verification has lapsed: ${checkedMs === undefined ? "no dated check" : `the latest check is older than ${reverifyDays} days`}.`);
      cells.push({
        platform,
        verified: holds && !stale,
        delivered,
        stale,
        ...(holds && checkedMs !== undefined ? { checked_at: isoOf(checkedMs) } : {}),
      });
    }
  }

  // The ladder, top rule first.
  const deliveryRequired = delivery === "required";
  const committed = answer !== undefined || directPromises.length > 0;
  let state: StakeStateId | null;
  if (stake.status === "archived") {
    state = null;
    reasons.unshift("Archived: an archived stake derives no state.");
  } else if (committed && hasDod && cells.every((cell) => cell.verified && (!deliveryRequired || cell.delivered))) {
    state = "addressed";
    reasons.push(deliveryRequired ? "Verified and delivered on every platform concerned." : "Verified on every platform concerned.");
  } else if (hasDod && deliveryRequired && cells.every((cell) => cell.verified) && !cells.some((cell) => cell.delivered)) {
    state = "verified-not-delivered";
    reasons.push("Verified everywhere, delivered nowhere: merged, not yet live.");
  } else if (cells.some((cell) => !cell.stale && (cell.verified || (cell.delivered && delivery !== "not-required")))) {
    state = "partly-addressed";
    reasons.push("The proof holds on some platforms, not on every one the answer concerns.");
  } else if ((answer !== undefined && hasDod) || directPromises.length > 0) {
    state = "promised";
    reasons.push(cells.some((cell) => cell.stale) ? "Promised: the verification lapsed, so it reads as promised until a new check passes." : "Promised: a decision chose an answer and it has a definition of done.");
  } else if (
    optionsAddressing(stake.id, nodes, edges).length > 0 ||
    candidatesFor(stake.id, nodes, edges).length > 0 ||
    (userFacing && (prepared.input.weighing?.assessments?.some?.((row) => isRecord(row) && row.subject === stake.id) === true || stakeMattersOf(stake) !== undefined)) ||
    (quality && criterionId !== undefined)
  ) {
    state = "considered";
    reasons.push(
      answer !== undefined
        ? "Considered: a decision chose an option, but the answer has no definition of done yet."
        : "Considered: an option or a candidate addresses it, or it has been evaluated.",
    );
  } else {
    state = "raised";
    reasons.push("Raised: nothing addresses it yet.");
  }

  return {
    stake_id: stake.id,
    ...(species !== undefined ? { stake_species: species } : {}),
    ...(answerType !== undefined ? { answer_type: answerType } : {}),
    state,
    ...(answer !== undefined ? { answer } : {}),
    definition_of_done: dod.map((acceptance) => acceptance.id),
    delivery,
    cells,
    reasons,
  };
}

/**
 * The proof of one stake, or `null` when the id names no stake. See the module
 * header for the rules; the ladder is RFC § 14, call 5.
 */
export function deriveStakeProof(input: StakeProofInput): StakeProof | null {
  const prepared = prepare(input);
  const stake = prepared.nodes.find((node) => node.id === input.stakeId);
  return stake === undefined || stake.species !== "stake" ? null : proofFor(prepared, stake);
}

/** The proof of every stake, in node order. The same as calling {@link deriveStakeProof} for each, preparing the inputs once. */
export function deriveStakeProofs(input: StakeProofsInput): StakeProof[] {
  const prepared = prepare(input);
  return prepared.nodes.filter((node) => node.species === "stake").map((stake) => proofFor(prepared, stake));
}
