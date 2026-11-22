/**
 * The qualification half of the tool catalog (docs/rfcs/stake-architecture.md
 * § 9) — `qualify_signal` reads a signal and proposes what to do with it,
 * `promote_signal` records the decision as a stake.
 *
 * **The agent supplies the facts, the table decides.** Whether a thing is broken
 * or merely in the way is a judgement, so the caller answers the routing
 * questions and `routeSpecies` (`@arkaik/schema`'s qualify.ts) applies the RFC's
 * table to them. The questions in the tool descriptions are the table's own
 * `ROUTING_QUESTIONS`, so the text cannot drift.
 *
 * **Op-only, so it works hosted.** `promote_signal` writes a node and its edges
 * (or one node patch), never a journal-only event, so a hosted session can use
 * it where `file_request` is refused. It goes through the same `applyOps` and
 * validator-gated persist as every other writer. It never merges on its own: a
 * merge is always an explicit `merge_into`.
 */

import {
  QUALIFY_BASES,
  QUALIFY_DOORS,
  QUALIFY_EXPECTATIONS,
  QUALIFY_FACINGS,
  QUALIFY_SCOPES,
  QUALIFY_THREATS,
  QUALITY_STAKE_SPECIES,
  ROUTING_QUESTIONS,
  STAKE_ANCHOR_SPECIES,
  STAKE_EVIDENCE_VOICES,
  catalogSourceForStakeSpecies,
  findMergeCandidates,
  planSignalMerge,
  planSignalToStake,
  routeSpecies,
  signalSourceKindOf,
  stakeAnchors,
  type JournalEvent,
  type MergeCandidate,
  type MutationOp,
  type MutationOutcome,
  type Node,
  type QualificationPlan,
  type QualificationSignal,
  type RequestFiledEvent,
  type RoutingAnswers,
  type SignalLike,
  type SpeciesRouting,
  type StakeCatalogLink,
  type StakeEvidenceVoice,
  type StakeSpeciesId,
} from "@arkaik/schema";
import { ToolError, type ToolDefinition, type ToolHandler } from "./protocol";
import type { Store, WriteResult } from "./store";
import type { LoadedGraph } from "./tools";

export interface QualifyToolContext {
  store: Store;
}

/** The shared plumbing from tools.ts, passed in so this module needs no import cycle. */
export interface QualifyIo {
  load(): Promise<LoadedGraph>;
  mutate(graph: LoadedGraph, ops: MutationOp[]): MutationOutcome;
  unwrap(result: WriteResult): { warnings: unknown[]; events: JournalEvent[] };
}

/** A signal as the tools read it: a journal event, or the fields an agent passed inline. */
interface ResolvedSignal {
  event_id?: string;
  title: string;
  verbatim?: string;
  date?: string;
  source_kind?: ReturnType<typeof signalSourceKindOf>;
  provenance?: "observed" | "anticipated";
  node_id?: string;
  criterion_id?: string;
}

const questionText = ROUTING_QUESTIONS.map((q) => `${q.id}: ${q.question} (${Object.keys(q.answers).join(" | ")})`).join(" ");

const ANSWER_PROPERTIES = {
  scope: { type: "string", enum: [...QUALIFY_SCOPES] },
  door: { type: "string", enum: [...QUALIFY_DOORS], description: "Default: collect for an observed signal, imagine for an anticipated one." },
  facing: { type: "string", enum: [...QUALIFY_FACINGS] },
  expectation: { type: "string", enum: [...QUALIFY_EXPECTATIONS], description: "When facing is value." },
  threat: { type: "string", enum: [...QUALIFY_THREATS], description: "When facing is quality." },
  basis: { type: "string", enum: [...QUALIFY_BASES], description: "Default: stated." },
};

const SIGNAL_PROPERTIES = {
  signal_id: { type: "string", description: "A request.filed or idea.proposed event id from the backlog. Or pass title inline." },
  title: { type: "string", description: "Inline signal, when it has no journal event (then no evidence event_id is recorded)." },
  verbatim: { type: "string", description: "Inline signal: the input exactly as voiced." },
  anchors: {
    type: "array",
    items: { type: "string" },
    description: "Flow, view, data-model or api-endpoint ids the stake concerns. Defaults to the signal's node_id when that is one.",
  },
  catalog_id: { type: "string", description: "A Kritik criterion id (requirement, risk, defect) or a value id (bug, friction, need). Defaults to an audit finding's criterion_id." },
};

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

function readEnum<T extends string>(args: Record<string, unknown>, key: string, allowed: readonly T[]): T | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (!(allowed as readonly unknown[]).includes(value)) throw new ToolError(`\`${key}\` must be one of: ${allowed.join(", ")}.`);
  return value as T;
}

function readAnswers(args: Record<string, unknown>, signal: ResolvedSignal): RoutingAnswers {
  const answers: RoutingAnswers = { door: readEnum(args, "door", QUALIFY_DOORS) ?? (signal.provenance === "anticipated" ? "imagine" : "collect") };
  const scope = readEnum(args, "scope", QUALIFY_SCOPES);
  const facing = readEnum(args, "facing", QUALIFY_FACINGS);
  const expectation = readEnum(args, "expectation", QUALIFY_EXPECTATIONS);
  const threat = readEnum(args, "threat", QUALIFY_THREATS);
  const basis = readEnum(args, "basis", QUALIFY_BASES);
  if (scope !== undefined) answers.scope = scope;
  if (facing !== undefined) answers.facing = facing;
  if (expectation !== undefined) answers.expectation = expectation;
  if (threat !== undefined) answers.threat = threat;
  if (basis !== undefined) answers.basis = basis;
  return answers;
}

function resolveSignal(args: Record<string, unknown>, journal: readonly JournalEvent[]): ResolvedSignal {
  const signalId = optionalString(args, "signal_id");
  if (signalId === undefined) {
    const title = optionalString(args, "title");
    if (title === undefined) throw new ToolError("Pass `signal_id` (a backlog event id) or an inline `title`.");
    const verbatim = optionalString(args, "verbatim");
    return { title, ...(verbatim !== undefined ? { verbatim } : {}) };
  }
  const event = journal.find((candidate) => candidate.id === signalId);
  if (event === undefined || (event.type !== "request.filed" && event.type !== "idea.proposed")) {
    throw new ToolError(`No request.filed or idea.proposed event with id "${signalId}".`);
  }
  const request = event as RequestFiledEvent;
  const kind = event.type === "idea.proposed" ? "idea" : signalSourceKindOf(request);
  return {
    event_id: event.id,
    title: typeof request.title === "string" ? request.title : signalId,
    ...(typeof request.verbatim === "string" && request.verbatim !== "" ? { verbatim: request.verbatim } : {}),
    date: event.ts,
    ...(kind !== undefined ? { source_kind: kind } : {}),
    ...(request.provenance === "anticipated" || request.provenance === "observed" ? { provenance: request.provenance } : {}),
    ...(typeof request.node_id === "string" ? { node_id: request.node_id } : {}),
    ...(typeof request.criterion_id === "string" ? { criterion_id: request.criterion_id } : {}),
  };
}

function resolveAnchors(args: Record<string, unknown>, signal: ResolvedSignal, nodes: readonly Node[]): string[] {
  if (args.anchors !== undefined) {
    if (!Array.isArray(args.anchors) || args.anchors.some((id) => typeof id !== "string" || id === "")) {
      throw new ToolError("`anchors` must be an array of node ids.");
    }
    return args.anchors as string[];
  }
  const node = signal.node_id === undefined ? undefined : nodes.find((candidate) => candidate.id === signal.node_id);
  return node !== undefined && (STAKE_ANCHOR_SPECIES as readonly string[]).includes(node.species) ? [node.id] : [];
}

function resolveCatalogId(args: Record<string, unknown>, signal: ResolvedSignal, species: StakeSpeciesId): string | undefined {
  const explicit = optionalString(args, "catalog_id");
  if (explicit !== undefined) return explicit;
  return (QUALITY_STAKE_SPECIES as readonly string[]).includes(species) ? signal.criterion_id : undefined;
}

type Suggestion =
  | { action: "ask" | "refused" | "route-out" | "create" }
  | { action: "already-qualified"; stake_id: string }
  | { action: "merge"; merge_into: string; confidence: MergeCandidate["confidence"] };

function suggestionFor(routing: SpeciesRouting, candidates: readonly MergeCandidate[]): Suggestion {
  if (routing.route === "incomplete") return { action: "ask" };
  if (routing.route === "refused") return { action: "refused" };
  if (routing.route !== "stake") return { action: "route-out" };
  const top = candidates[0];
  if (top?.alreadyCited) return { action: "already-qualified", stake_id: top.stake_id };
  if (top !== undefined && (top.confidence === "high" || top.confidence === "medium")) {
    return { action: "merge", merge_into: top.stake_id, confidence: top.confidence };
  }
  return { action: "create" };
}

export function buildQualifyCatalog(
  ctx: QualifyToolContext,
  io: QualifyIo,
): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [];
  const handlers: Record<string, ToolHandler> = {};
  const tool = (definition: ToolDefinition, handler: ToolHandler) => {
    tools.push(definition);
    handlers[definition.name] = handler;
  };

  tool(
    {
      name: "qualify_signal",
      description: `Read-only. Route a signal (a backlog event or an inline title) to a stake species and list the existing stakes it could merge into. You answer the routing questions; the table decides. ${questionText} A bug or friction cannot come through the imagine door: reroute as need. Anything routed out, refused or inferred is for a person to confirm. Returns { routing, candidates, suggestion }; it never writes and never merges on its own.`,
      inputSchema: {
        type: "object",
        properties: { ...SIGNAL_PROPERTIES, ...ANSWER_PROPERTIES },
        additionalProperties: false,
      },
    },
    async (args) => {
      const graph = await io.load();
      const signal = resolveSignal(args, graph.journal);
      const routing = routeSpecies(readAnswers(args, signal));
      const anchors = resolveAnchors(args, signal, graph.nodes);
      const catalog_id = routing.species !== undefined ? resolveCatalogId(args, signal, routing.species) : undefined;

      let candidates: MergeCandidate[] = [];
      if (routing.route === "stake" && routing.species !== undefined) {
        const like: SignalLike = {
          title: signal.title,
          species: routing.species,
          node_ids: anchors,
          ...(signal.event_id !== undefined ? { event_id: signal.event_id } : {}),
          ...(signal.verbatim !== undefined ? { verbatim: signal.verbatim } : {}),
          ...(catalog_id !== undefined ? { catalog_id } : {}),
          ...(signal.source_kind !== undefined ? { source_kind: signal.source_kind } : {}),
        };
        candidates = findMergeCandidates(like, graph.nodes, { edges: graph.edges });
      }

      return {
        signal: {
          ...(signal.event_id !== undefined ? { event_id: signal.event_id } : {}),
          title: signal.title,
          ...(signal.source_kind !== undefined ? { source_kind: signal.source_kind } : {}),
          ...(signal.provenance !== undefined ? { provenance: signal.provenance } : {}),
        },
        routing,
        anchors,
        ...(catalog_id !== undefined ? { catalog_id } : {}),
        candidates,
        suggestion: suggestionFor(routing, candidates),
        ...(routing.route === "incomplete" ? { questions: ROUTING_QUESTIONS.filter((question) => routing.ask.includes(question.id)) } : {}),
      };
    },
  );

  tool(
    {
      name: "promote_signal",
      description: `Record a qualified signal as a stake: create one (create: true) or append the signal as evidence to an existing stake (merge_into). Answer the same routing questions as qualify_signal; a route that is not a stake, or a species the door forbids, is refused. A created stake lands at idea with the species, provenance, a first evidence entry and one concerns edge per anchor; stake_title is the stake's own wording (write it positively and solution-neutral; it defaults to the signal's title). Re-promoting a signal a stake already cites is a no-op. Never merges unless you name merge_into. Works on a repo and a hosted project.`,
      inputSchema: {
        type: "object",
        properties: {
          ...SIGNAL_PROPERTIES,
          ...ANSWER_PROPERTIES,
          create: { type: "boolean", description: "Create a new stake. Exactly one of create / merge_into." },
          merge_into: { type: "string", description: "The stake id to add the signal to as evidence." },
          stake_title: { type: "string", description: "The new stake's wording." },
          voice: { type: "string", enum: [...STAKE_EVIDENCE_VOICES], description: "Who voiced the signal." },
        },
        additionalProperties: false,
      },
    },
    async (args) => {
      const graph = await io.load();
      const signal = resolveSignal(args, graph.journal);
      const mergeInto = optionalString(args, "merge_into");
      if ((mergeInto !== undefined) === (args.create === true)) {
        throw new ToolError("Pass exactly one of `create: true` or `merge_into` (a stake id).");
      }
      const routing = routeSpecies(readAnswers(args, signal));
      if (routing.route !== "stake" || routing.species === undefined || routing.provenance === undefined) {
        throw new ToolError(
          routing.route === "incomplete"
            ? `Not enough answers to route the species: ${routing.ask.join(", ")}. Call qualify_signal first.`
            : `Not promoted: ${routing.reasons.join(" ")}`,
          { routing },
        );
      }
      const voice = readEnum<StakeEvidenceVoice>(args, "voice", STAKE_EVIDENCE_VOICES);
      const evidenceSignal: QualificationSignal = {
        title: signal.title,
        ...(signal.event_id !== undefined ? { event_id: signal.event_id } : {}),
        ...(signal.verbatim !== undefined ? { verbatim: signal.verbatim } : {}),
        ...(signal.date !== undefined ? { date: signal.date } : {}),
        ...(voice !== undefined ? { voice } : {}),
      };

      let plan: QualificationPlan;
      if (mergeInto !== undefined) {
        const target = graph.nodes.find((node) => node.id === mergeInto);
        if (target === undefined) throw new ToolError(`No node with id "${mergeInto}".`);
        plan = planSignalMerge({ signal: evidenceSignal, target, species: routing.species, nodes: graph.nodes });
      } else {
        const catalogId = resolveCatalogId(args, signal, routing.species);
        const catalog: StakeCatalogLink | undefined =
          catalogId !== undefined ? { source: catalogSourceForStakeSpecies(routing.species), id: catalogId } : undefined;
        const title = optionalString(args, "stake_title");
        plan = planSignalToStake({
          projectId: graph.project.id,
          signal: evidenceSignal,
          species: routing.species,
          provenance: routing.provenance,
          anchors: resolveAnchors(args, signal, graph.nodes),
          nodes: graph.nodes,
          edges: graph.edges,
          ...(title !== undefined ? { title } : {}),
          ...(catalog !== undefined ? { catalog } : {}),
        });
      }

      const handToHuman = [...routing.handToHuman, ...plan.handToHuman];
      if (plan.action === "refused") throw new ToolError(`Not promoted: ${plan.reasons.join(" ")}`, { reasons: plan.reasons });
      if (plan.action === "noop") {
        return { action: "noop", stake_id: plan.stake_id, reasons: plan.reasons, ops: [], events: [], warnings: [], handToHuman };
      }

      const outcome = io.mutate(graph, plan.ops);
      const result = await ctx.store.persist(graph, { nodes: outcome.nodes, edges: outcome.edges, ops: plan.ops }, outcome.eventInputs);
      const { warnings, events } = io.unwrap(result);
      const stakeId = plan.stake_id as string;
      return {
        action: plan.action,
        stake_id: stakeId,
        stake: outcome.nodes.find((node) => node.id === stakeId),
        anchors: stakeAnchors(stakeId, outcome.edges),
        ops: plan.ops,
        events,
        warnings,
        handToHuman,
      };
    },
  );

  return { tools, handlers };
}
