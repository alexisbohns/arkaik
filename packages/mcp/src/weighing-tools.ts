/**
 * The weighing half of the tool catalog (docs/rfcs/weighing.md) — `get_matrix`,
 * `assess` and `save_positioning`, the agent plane's way of reading what each
 * promise is worth and writing a judgement about it. They mirror
 * `kritik_matrix` and `kritik_score`, and go through the same validator-gated
 * write path.
 *
 * **The same code as every other writer.** A level written here goes through
 * `planWeighingEvents`, the one gate the hosted route and the browser provider
 * also use, so a score written by an agent and a score written by a person have
 * been checked against the same library, the same scale and the same subject
 * rule. The derived numbers a read returns are `@arkaik/schema`'s
 * (`weighing-derive.ts`), never recomputed here.
 *
 * **Two stores, one gate.** In a repository the sidecar files under
 * `docs/weighing/` are canonical, so `assess` upserts one row into
 * `assessments/<matrix>.json` and writes no journal event — the file is the
 * record and git its history, as for `kritik_score`. A hosted project has no
 * such directory: `assess` posts to `POST …/weighing/events` and the server
 * folds the event back into every read. The tools do not branch on anything
 * else, and both modes work.
 *
 * **An agent writes as an agent.** The scorer kind is stamped `agent` — here
 * from the server's identity, on the hosted route from the token — never from
 * an argument, because a human's level wins every cell and a caller must not be
 * able to claim to be one. What an agent may say about itself is `model`.
 *
 * **On whose behalf (D14).** Hosted, the server stamps `scorer.on_behalf_of`
 * from the token, and this module sends nothing. In a repository nothing but
 * the checkout identifies a person, so {@link resolveOnBehalfOf} reads the
 * first usable of: `ARKAIK_ON_BEHALF_OF`, `git config arkaik.user`, `git config
 * user.name` (the git author name, never `user.email`). Anything email-shaped
 * is skipped, not refused — scoring still works — and with none left the field
 * is absent, as in an unattended CI run.
 */

import {
  CONFIDENCE_ANCHORS,
  POSITIONING_SET_ID,
  STAKE_MATRIX_ID,
  VALUE_MATRIX_ID,
  VALUE_SET_ID,
  WEIGHING_ASSESSMENT_RECORDED,
  WEIGHING_SET_SAVED,
  buildWeighingContext,
  deriveWeighing,
  isActiveWeighingSet,
  isValidOnBehalfOf,
  planWeighingEvents,
  resolveWeighing,
  referenceForStakeSpecies,
  sortPromises,
  stakeFeltOf,
  stakeFrequencyOf,
  stakeMattersOf,
  stakeSpeciesOf,
  upsertWeighingAssessment,
  weighPromise,
  weighingScaleOf,
  type WeighingAssessment,
  type WeighingCriteriaSet,
  type EffectiveCell,
  type JournalEvent,
  type Node,
  type PromiseWeighing,
  type WeighingEventInput,
  type WeighingSection,
} from "@arkaik/schema";
import {
  loadMatrixAssessments,
  loadWeighingSection,
  saveWeighingAssessments,
  saveWeighingSet,
  weighingAssessmentsPath,
  weighingSetPath,
} from "@arkaik/schema/src/cli/weighing-files";
import { execFile } from "node:child_process";
import { ToolError, type ToolDefinition, type ToolHandler } from "./protocol";
import { MCP_ACTOR, type LoadedGraph, type Store } from "./store";

export interface WeighingToolContext {
  store: Store;
  /**
   * The repo root holding `docs/weighing/`, or `undefined` in hosted mode — the
   * same root `docs/quality/` is found under, set by index.ts from the resolved
   * bundle path.
   */
  qualityRoot?: string;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** How long one `git config` may take: it reads a file, so a longer wait means git is hung (a network home, a lock) and `assess` must not wait on it. */
const GIT_CONFIG_TIMEOUT_MS = 1500;

/**
 * `git config --get <key>` read in `root`. No shell. `value` is `undefined` for
 * every failure (no git, no repo, not set, empty); `timedOut` says git was
 * killed for taking too long, which the caller treats as "stop asking".
 */
function gitConfigValue(root: string, key: string): Promise<{ value?: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    try {
      execFile("git", ["config", "--get", key], { cwd: root, timeout: GIT_CONFIG_TIMEOUT_MS }, (error, stdout) => {
        if (error !== null) return resolve({ timedOut: (error as { killed?: boolean }).killed === true });
        const value = String(stdout).trim();
        resolve({ ...(value === "" ? {} : { value }), timedOut: false });
      });
    } catch {
      resolve({ timedOut: false });
    }
  });
}

/** The opt-out: this as `ARKAIK_ON_BEHALF_OF` or `git config arkaik.user` means "record nobody". */
export const ON_BEHALF_OF_NOBODY = "-";

/**
 * D14, repo mode: whom this session scores for. The first usable of
 *
 * 1. `ARKAIK_ON_BEHALF_OF`, trimmed;
 * 2. `git config arkaik.user`, read in the repo root;
 * 3. `git config user.name`, the git author name.
 *
 * **Never the email**: `user.email` is not a source, and a value that is
 * email-shaped (or otherwise refused by the planner's guard, {@link isValidOnBehalfOf})
 * in any of the three is skipped — the next source is tried, so scoring still
 * works. `undefined` when none is usable (an unattended CI run). Read per call,
 * so a config change mid-session is honoured; the env var, when usable, costs no
 * process.
 *
 * **The opt-out.** A sidecar is committed, so the default writes the git author
 * name into a repo's history. `-` (see {@link ON_BEHALF_OF_NOBODY}) in
 * `ARKAIK_ON_BEHALF_OF` or `arkaik.user` means "record nobody": nothing is
 * stamped and the chain stops, so the git name is not read. An EMPTY value is
 * not that — it is "not set", and falls through. A git that times out
 * ({@link GIT_CONFIG_TIMEOUT_MS}) ends the chain too: no second wait for `user.name`.
 */
export async function resolveOnBehalfOf(root: string, env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  const fromEnv = env.ARKAIK_ON_BEHALF_OF?.trim();
  if (fromEnv === ON_BEHALF_OF_NOBODY) return undefined;
  if (fromEnv !== undefined && isValidOnBehalfOf(fromEnv)) return fromEnv;
  for (const key of ["arkaik.user", "user.name"]) {
    const { value, timedOut } = await gitConfigValue(root, key);
    if (timedOut) return undefined;
    if (key === "arkaik.user" && value === ON_BEHALF_OF_NOBODY) return undefined;
    if (value !== undefined && value !== ON_BEHALF_OF_NOBODY && isValidOnBehalfOf(value)) return value;
  }
  return undefined;
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.length === 0) throw new ToolError(`\`${key}\` is required and must be a non-empty string.`);
  return value;
}

function requireInt(args: Record<string, unknown>, key: string, min: number, max: number): number {
  const value = args[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new ToolError(`\`${key}\` is required and must be an integer ${min} to ${max}.`);
  }
  return value;
}

const optionalString = (args: Record<string, unknown>, key: string): string | undefined =>
  typeof args[key] === "string" && args[key] !== "" ? (args[key] as string) : undefined;

/** One cell, in the shape an agent reads. Probabilities only when asked for: the `uncertain` marker is the part worth reading. */
function cellRow(cell: EffectiveCell, withProbabilities: boolean) {
  return {
    criterion: cell.criterion,
    level: cell.level,
    scorer: cell.scorer,
    confidence: cell.confidence,
    source: cell.source,
    stale: cell.stale,
    ...(cell.stale_by !== undefined ? { stale_by: cell.stale_by } : {}),
    claimed: cell.claimed,
    ...(cell.evidence !== undefined ? { evidence: cell.evidence } : {}),
    ...(cell.review ? { review: true } : {}),
    ...(cell.uncertain ? { uncertain: true } : {}),
    ...(withProbabilities && cell.p_serves !== undefined ? { p_serves: cell.p_serves } : {}),
    ...(withProbabilities && cell.p_costs !== undefined ? { p_costs: cell.p_costs } : {}),
    ...(cell.others.length > 0
      ? { others: cell.others.map((row) => ({ scorer: row.scorer, level: row.level, confidence: row.confidence, ...(row.evidence !== undefined ? { evidence: row.evidence } : {}) })) }
      : {}),
  };
}

/**
 * A stake's own facts beside its score: its kind, the reference that reads it,
 * and felt / matters / frequency when it has them. Shown, never summed with
 * the pyramid's levels and never sorted by.
 */
function stakeFacts(node: Node | undefined) {
  if (node === undefined || node.species !== "stake") return {};
  const kind = stakeSpeciesOf(node);
  return {
    stake: {
      stake_species: kind ?? null,
      ...(kind !== undefined ? { reference: referenceForStakeSpecies(kind) } : {}),
      ...(stakeFeltOf(node) !== undefined ? { felt: stakeFeltOf(node) } : {}),
      ...(stakeMattersOf(node) !== undefined ? { matters: stakeMattersOf(node) } : {}),
      ...(stakeFrequencyOf(node) !== undefined ? { frequency: stakeFrequencyOf(node) } : {}),
    },
  };
}

/** The matrix a subject is weighed on when none is named: a stake on the stake matrix, anything else on the value matrix. */
const defaultMatrixFor = (nodes: readonly Node[], subject: string | undefined): string =>
  nodes.find((candidate) => candidate.id === subject)?.species === "stake" ? STAKE_MATRIX_ID : VALUE_MATRIX_ID;

/** One promise: the numbers every time, the cells only when asked for. */
function promiseRow(promise: PromiseWeighing, withCells: boolean, withProbabilities = false, node?: Node) {
  return {
    ...stakeFacts(node),
    node_id: promise.node_id,
    title: promise.title,
    status: promise.status,
    served: round2(promise.served),
    cost: round2(promise.cost),
    positioned:
      promise.positioned === null
        ? null
        : {
            served: round2(promise.positioned.served),
            cost: round2(promise.positioned.cost),
            guesswork: { served: round2(promise.positioned.guesswork.served), cost: round2(promise.positioned.guesswork.cost) },
          },
    kept_share: promise.kept_share === null ? null : round2(promise.kept_share),
    guesswork: { served: round2(promise.guesswork.served), cost: round2(promise.guesswork.cost) },
    flags: promise.flags,
    stale: promise.stale,
    review: promise.review,
    uncertain: promise.uncertain,
    ...(promise.archived ? { archived: true } : {}),
    ...(withCells ? { cells: promise.cells.map((cell) => cellRow(cell, withProbabilities)) } : {}),
  };
}

const FILTERS = ["flagged", "stale", "review", "uncertain", "unassessed"] as const;

function matchesFilter(promise: PromiseWeighing, filter: string): boolean {
  switch (filter) {
    case "flagged":
      return Object.values(promise.flags).some((ids) => ids.length > 0);
    case "stale":
      return promise.stale.length > 0;
    case "review":
      return promise.review.length > 0;
    case "uncertain":
      return promise.uncertain.length > 0;
    case "unassessed":
      return !promise.cells.some((cell) => cell.source === "stored");
    default:
      return true;
  }
}

export function buildWeighingCatalog(ctx: WeighingToolContext): {
  tools: ToolDefinition[];
  handlers: Record<string, ToolHandler>;
} {
  const tools: ToolDefinition[] = [];
  const handlers: Record<string, ToolHandler> = {};
  const tool = (definition: ToolDefinition, handler: ToolHandler) => {
    tools.push(definition);
    handlers[definition.name] = handler;
  };


  const load = async (): Promise<LoadedGraph> => {
    try {
      return await ctx.store.load();
    } catch (error) {
      throw new ToolError(`Cannot load ${ctx.store.describe()}: ${(error as Error).message}`);
    }
  };

  /** The section as this session sees it: the sidecars in a repo, the server's fold when hosted. */
  const sectionOf = (graph: LoadedGraph): WeighingSection | undefined => {
    if (ctx.qualityRoot === undefined) return (graph.loaded.bundle as { weighing?: WeighingSection }).weighing;
    try {
      return loadWeighingSection(ctx.qualityRoot);
    } catch (error) {
      throw new ToolError((error as Error).message);
    }
  };

  const appendHosted = async (inputs: readonly WeighingEventInput[]): Promise<JournalEvent[]> => {
    if (ctx.store.appendWeighingEvents === undefined) throw new ToolError(`${ctx.store.describe()} cannot record assessments.`);
    try {
      return await ctx.store.appendWeighingEvents(inputs);
    } catch (error) {
      // The remote store attaches the server's structured refusals; carry them as a repo refusal does.
      const refusals = (error as { refusals?: unknown }).refusals;
      throw new ToolError((error as Error).message, refusals !== undefined ? { refusals } : undefined);
    }
  };

  // ---- Read -----------------------------------------------------------------

  tool(
    {
      name: "get_matrix",
      description:
        "The value matrix: what each promise (acceptance) is worth, against the 30 elements of value on a signed -3..+3 scale that measures REACH in a person's life: +1 within the product, +2 across the product's domain, +3 life-wide; the negatives mirror it, and 0 is weighed and unrelated. Most real promises land at +1; +3 is rare. Each element has its own ladder of what every level means. Per promise: `served` (sum of positive levels / 3) and `cost` (sum of |negative levels| / 3), NEVER netted; `positioned` (the same over the elements the product's active positioning stands on, each times its weight); `kept_share` (platforms where it is live / platforms it applies to); `guesswork` (the share of served and of cost resting on confidence-0 cells; `positioned` carries its own, and every mass and total says how much of it is guesswork). `flags` is a partition: claim_not_supported (claimed in metadata.values but assessed 0), claim_contradicted (claimed but assessed negative), unclaimed_value (not claimed, assessed 1 or more) and unclaimed_cost (not claimed, assessed negative — authors claim intent, so a cost is never claimed). `stale` lists elements whose winning level was scored before the promise's title, Gherkin or values changed, or against an older major of the ruler; `review` lists elements where a human and an agent differ by 2 or more; `uncertain` lists elements whose winning level a probabilistic scorer was unsure of (read it as a range). A cell nobody has scored reads at a SEEDED level: every claimed value +1 (scorer rule, confidence 0), a guess, never a score — negatives are never seeded. A human's level beats an agent's beats a seed, whatever the dates. Pass `subject` for one promise with every cell, its evidence, and each element's question and ladder — what you read before calling assess. Otherwise it lists promises (sort: served | cost | positioned | title; filter: flagged | stale | review | uncertain | unassessed; limit) plus the per-element promised / kept / cost masses. `probabilities: true` adds each cell's stored p_serves / p_costs. A draft positioning feeds nothing. The \`stakes\` matrix weighs stakes of the kinds the ruler declares (bug, friction, need) on the same elements and ladder, in its own cells, never added to the promises'; a stake is never seeded and claims nothing, so it has no claim flags and no kept share, and each row carries the stake's kind, its reference and its felt / matters / frequency when set (shown beside the score, never summed with it). A requirement, risk or defect is not weighed: it is read against a Kritik criterion.",
      inputSchema: {
        type: "object",
        properties: {
          matrix: { type: "string", description: `Default: ${VALUE_MATRIX_ID}, or ${STAKE_MATRIX_ID} when \`subject\` is a stake.` },
          subject: { type: "string", description: "An acceptance or stake id: return that promise with every cell." },
          sort: { type: "string", enum: ["served", "cost", "positioned", "title"], description: "Default: served, heaviest first." },
          filter: { type: "string", enum: [...FILTERS] },
          limit: { type: "integer", minimum: 1, maximum: 200, description: "Default 25." },
          probabilities: { type: "boolean", description: "With `subject`: add each cell's stored p_serves / p_costs. Default false — the `uncertain` marker is usually enough." },
        },
        additionalProperties: false,
      },
    },
    async (args) => {
      const graph = await load();
      const section = sectionOf(graph);
      const nodes = graph.nodes as Node[];
      const matrixId = optionalString(args, "matrix") ?? defaultMatrixFor(nodes, optionalString(args, "subject"));
      const view = deriveWeighing(nodes, section, matrixId);
      if (view === undefined) throw new ToolError(`No usable matrix "${matrixId}" (unknown, or a draft — a draft feeds no roll-up). The built-in ones are "${VALUE_MATRIX_ID}" and "${STAKE_MATRIX_ID}".`);
      const judgesStakes = view.matrix.subjects.kind === "query" && view.matrix.subjects.species === "stake";
      const nodesById = new Map(nodes.map((node) => [node.id, node] as const));

      // The weights are the derivation's own (`positioningWeights`: default 1, 0 is 0, the first duplicate wins), never a second copy of that rule.
      const positioning =
        view.positioning === null
          ? null
          : {
              status: view.positioning.active ? "active" : "draft",
              elements: [...view.positioning.weights].map(([id, weight]) => {
                const anchors = view.positioning?.set.criteria.find((criterion) => criterion.id === id)?.anchors;
                return { id, weight, ...(anchors !== undefined ? { anchors } : {}) };
              }),
            };
      // What the resolver dropped (a malformed saved positioning, a duplicate id): said, not silent.
      const { skipped } = resolveWeighing(section);
      const notes: string[] = [];
      if (skipped.length > 0) notes.push(`${skipped.length} stored set(s) or matrix(es) are malformed or duplicated and are ignored — see \`skipped\`.`);
      if (view.positioning !== null && !view.positioning.active) notes.push("The positioning is a draft — `positioned` figures are absent until it is saved as active.");
      if (view.totals.assessed === 0) {
        notes.push(judgesStakes ? "Nothing has been assessed yet — a stake is never seeded, so every cell is blank until someone scores it." : "Nothing has been assessed yet — every claimed value is seeded at +1 (confidence 0), a guess.");
      }

      const subject = optionalString(args, "subject");
      if (subject !== undefined) {
        const promise = view.promises.find((candidate) => candidate.node_id === subject);
        if (promise === undefined) throw new ToolError(`"${subject}" is not a subject of matrix "${matrixId}" (it judges ${view.matrix.subjects.kind === "query" ? `${view.matrix.subjects.species} nodes` : "a listed set"}).`);
        return {
          matrix: { id: view.matrix.id, set: view.matrix.set, set_version: view.set.version },
          scale: weighingScaleOf(view.set),
          // Each element's own question and ladder: a level means what ITS ladder says, the scale's anchors are the fallback.
          elements: view.set.criteria.map((criterion) => ({
            id: criterion.id,
            name: criterion.name,
            tier: criterion.group,
            ...(criterion.question !== undefined ? { question: criterion.question } : {}),
            ...(criterion.definition !== undefined ? { definition: criterion.definition } : {}),
            ...(criterion.anchors !== undefined ? { anchors: criterion.anchors } : {}),
          })),
          confidence_anchors: CONFIDENCE_ANCHORS,
          positioning,
          promise: promiseRow(promise, true, args.probabilities === true, nodesById.get(promise.node_id)),
          ...(skipped.length > 0 ? { skipped } : {}),
          ...(notes.length > 0 ? { notes } : {}),
        };
      }

      const sort = optionalString(args, "sort") ?? "served";
      if (!["served", "cost", "positioned", "title"].includes(sort)) throw new ToolError("`sort` must be served, cost, positioned or title.");
      const filter = optionalString(args, "filter");
      if (filter !== undefined && !(FILTERS as readonly string[]).includes(filter)) throw new ToolError(`\`filter\` must be one of ${FILTERS.join(", ")}.`);
      const limit = typeof args.limit === "number" && Number.isInteger(args.limit) ? Math.min(Math.max(args.limit, 1), 200) : 25;

      const matching = view.promises.filter((promise) => filter === undefined || matchesFilter(promise, filter));
      const ordered = sortPromises(matching, sort as "served" | "cost" | "positioned" | "title");
      const elements = view.set.criteria
        .map((criterion) => ({ criterion, mass: view.elements[criterion.id] }))
        .filter(({ mass }) => mass.promised > 0 || mass.cost > 0)
        .sort((a, b) => b.mass.promised - a.mass.promised)
        .map(({ criterion, mass }) => ({
          id: criterion.id,
          name: criterion.name,
          tier: criterion.group,
          promised: round2(mass.promised),
          kept: round2(mass.kept),
          cost: round2(mass.cost),
          guesswork: { promised: round2(mass.guesswork.promised), kept: round2(mass.guesswork.kept), cost: round2(mass.guesswork.cost) },
        }));
      return {
        matrix: { id: view.matrix.id, set: view.matrix.set, set_version: view.set.version },
        positioning,
        totals: {
          promises: view.totals.promises,
          archived: view.totals.archived,
          assessed: view.totals.assessed,
          promised: round2(view.totals.promised),
          kept: round2(view.totals.kept),
          cost: round2(view.totals.cost),
          guesswork: { promised: round2(view.totals.guesswork.promised), kept: round2(view.totals.guesswork.kept), cost: round2(view.totals.guesswork.cost) },
        },
        elements,
        promises: ordered.slice(0, limit).map((promise) => promiseRow(promise, false, false, nodesById.get(promise.node_id))),
        matching: ordered.length,
        ...(skipped.length > 0 ? { skipped } : {}),
        ...(notes.length > 0 ? { notes } : {}),
      };
    },
  );

  // ---- Write ----------------------------------------------------------------

  tool(
    {
      name: "assess",
      description:
        "Record one judgement: a signed level (-3..+3) for one promise on one value element, with how sure you are and why. Read the promise first with get_matrix `subject` so you score against the element's own ladder, not from memory: the level is how far into the person's life it reaches (+1 within the product, +2 across its domain, +3 life-wide). 0 means weighed and unrelated; a negative level is a COST (the promise works against that value) — score costs you find, authors rarely claim them, and an unclaimed cost is the most valuable thing an audit returns. `confidence`: 0 guess · 1 inferred from the promise's own text · 2 evidenced (cites something outside it) · 3 verified. `evidence` is required above confidence 0: a score without a citation is an opinion. Scored as an AGENT — a human's level for the same cell keeps winning and yours is recorded beside it, flagged for review when you differ by 2 or more. The tool stamps what you cannot: who you are (and, where it can tell, whose hands you are — in a repository that is your git author name, read from `ARKAIK_ON_BEHALF_OF`, then `git config arkaik.user`, then `git config user.name`, and written into the committed sidecar; set `arkaik.user` to `-` to record nobody), the set's version and a fingerprint of the promise, so a later edit to its title, Gherkin or values marks your score stale. In a repository it upserts docs/weighing/assessments/<matrix>.json (nothing in the journal); on a hosted project it records weighing.assessment.recorded. The write goes through the same validator-gated gate as the app's form: an unknown element, an out-of-range level or a subject that is not an acceptance (or a stake of a kind the ruler declares) refuses with the reason. A bug, friction or need stake is weighed here too, on the \`stakes\` matrix (the default for a stake subject): same elements, same ladder, its own cells. A requirement, risk or defect is refused: it is read against a Kritik criterion, and a Kritik criterion is never written as an assessment.",
      inputSchema: {
        type: "object",
        properties: {
          subject: { type: "string", description: "An acceptance id, or a bug, friction or need stake id." },
          criterion: { type: "string", description: "A value element id, e.g. reduces-anxiety." },
          level: { type: "integer", minimum: -3, maximum: 3 },
          confidence: { type: "integer", enum: [0, 1, 2, 3] },
          evidence: { type: "string", maxLength: 2000, description: "Markdown, at most 2,000 characters. Required when confidence is above 0." },
          refs: { type: "array", items: { type: "string", maxLength: 200 }, maxItems: 50, description: "Ids cited: nodes, journal events, findings. At most 50, each at most 200 characters." },
          model: { type: "string", maxLength: 200, description: "The model you are, when you know. At most 200 characters." },
          run: { type: "string", maxLength: 200, description: "The audit or session this score belongs to. At most 200 characters." },
          commit: { type: "string", maxLength: 200 },
          matrix: { type: "string", description: `Default: ${VALUE_MATRIX_ID}, or ${STAKE_MATRIX_ID} when the subject is a stake.` },
          p_serves: { type: "number", minimum: 0, maximum: 1, description: "Only from a probabilistic scorer: how sure it is (0 to 1) that the promise serves this element. Certainty, not size." },
          p_costs: { type: "number", minimum: 0, maximum: 1, description: "The same for costs, asked independently. A level its scorer was unsure of reads as a range." },
        },
        required: ["subject", "criterion", "level", "confidence"],
        additionalProperties: false,
      },
    },
    async (args) => {
      const subject = requireString(args, "subject");
      const criterion = requireString(args, "criterion");
      // Only that it is a whole number: the range is the planner's to judge (it says `level_out_of_range`, with the scale).
      const level = args.level;
      if (typeof level !== "number" || !Number.isInteger(level)) throw new ToolError("`level` is required and must be an integer (the scale is -3 to +3).");
      const confidence = requireInt(args, "confidence", 0, 3);
      const evidence = optionalString(args, "evidence");
      if (confidence > 0 && (evidence === undefined || evidence.trim() === "")) {
        throw new ToolError("`evidence` is required above confidence 0 — a score without a citation is an opinion, not an assessment. Say what you read, or score at confidence 0.");
      }
      const refs = Array.isArray(args.refs) ? (args.refs as unknown[]).filter((ref): ref is string => typeof ref === "string" && ref !== "") : undefined;
      const input: WeighingEventInput = {
        type: WEIGHING_ASSESSMENT_RECORDED,
        subject,
        criterion,
        level,
        confidence,
        ...(optionalString(args, "matrix") !== undefined ? { matrix: optionalString(args, "matrix") as string } : {}),
        ...(evidence !== undefined ? { evidence } : {}),
        ...(refs !== undefined && refs.length > 0 ? { refs } : {}),
        ...(optionalString(args, "model") !== undefined ? { model: optionalString(args, "model") as string } : {}),
        ...(optionalString(args, "run") !== undefined ? { run: optionalString(args, "run") as string } : {}),
        ...(optionalString(args, "commit") !== undefined ? { commit: optionalString(args, "commit") as string } : {}),
        // Passed as given: a value off 0..1 is the planner's to refuse, with the reason.
        ...(args.p_serves !== undefined ? { p_serves: args.p_serves as number } : {}),
        ...(args.p_costs !== undefined ? { p_costs: args.p_costs as number } : {}),
      };

      const graph = await load();
      const section = sectionOf(graph);
      const nodes = graph.nodes as Node[];

      // The matrix must be one a roll-up reads: a draft feeds none, so a score against it would be recorded and then count for nothing.
      const matrixId = input.matrix ?? defaultMatrixFor(nodes, subject);
      const view = buildWeighingContext(section, matrixId);
      if (view === undefined) {
        const matrix = resolveWeighing(section).matrices.find((candidate) => candidate.id === matrixId);
        if (matrix === undefined) throw new ToolError(`No matrix "${matrixId}". The built-in one is "${VALUE_MATRIX_ID}".`);
        if (!isActiveWeighingSet(matrix)) throw new ToolError("This matrix is a draft and feeds no roll-up; activate it first.");
        throw new ToolError(`Matrix "${matrixId}" names the set "${matrix.set}", which is not available.`);
      }
      // What the cell reads before this write, so the reply can say whose level stands.
      const node = nodes.find((candidate) => candidate.id === subject);
      const before = node !== undefined ? weighPromise(node, view).cells.find((cell) => cell.criterion === criterion) : undefined;

      const notes: string[] = [];
      if (before?.source === "stored" && before.scorer.kind === "human") {
        notes.push("A human's level already stands for this cell and keeps winning — yours is recorded beside it" + (Math.abs(before.level - level) >= 2 ? ", and the cell now sits on the review list (you differ by 2 or more)." : "."));
      }
      // The element's own ladder says what this level means; the scale's words are the fallback.
      const anchor = view.set.criteria.find((candidate) => candidate.id === criterion)?.anchors?.[String(level)] ?? weighingScaleOf(view.set).anchors[String(level)];

      if (ctx.qualityRoot === undefined) {
        const events = await appendHosted([input]);
        const recorded = events.find((event) => event.type === WEIGHING_ASSESSMENT_RECORDED);
        return { assessment: recorded, ...(anchor !== undefined ? { anchor } : {}), events, ...(notes.length > 0 ? { notes } : {}) };
      }

      const onBehalfOf = await resolveOnBehalfOf(ctx.qualityRoot);
      const plan = planWeighingEvents(section, nodes, [input], { actor: MCP_ACTOR, scorerKind: "agent", ...(onBehalfOf !== undefined ? { onBehalfOf } : {}) });
      if (!plan.ok) throw new ToolError(`Assessment refused — ${plan.refusals.map((r) => `${r.reason}: ${r.detail}`).join("; ")}`, { refusals: plan.refusals });
      const row = plan.assessments[0];
      let replaced: WeighingAssessment | undefined;
      try {
        const next = upsertWeighingAssessment(loadMatrixAssessments(ctx.qualityRoot, row.matrix), row);
        replaced = next.replaced;
        saveWeighingAssessments(ctx.qualityRoot, row.matrix, next.assessments);
      } catch (error) {
        throw new ToolError((error as Error).message);
      }
      return {
        assessment: row,
        file: weighingAssessmentsPath(ctx.qualityRoot, row.matrix),
        ...(replaced !== undefined ? { replaced_level: replaced.level } : {}),
        ...(anchor !== undefined ? { anchor } : {}),
        ...(notes.length > 0 ? { notes } : {}),
      };
    },
  );

  tool(
    {
      name: "save_positioning",
      description:
        "Write the product's positioning: the elements of value it stands on, each with a weight and, optionally, what each level means IN THE PRODUCT'S OWN WORDS (e.g. for reduces-anxiety: \"3 removes a worry the user names; 0 has nothing to do with worry\"). A positioning is a criteria set: a scorer — you, or another — reads those descriptions to judge a promise, and the weights make get_matrix's `positioned` figures. It REPLACES the previous positioning whole. `status` defaults to draft, and a draft feeds no roll-up: draft one from the landing page, the decisions or a brainstorm, and leave it for a person to read and save as active — you may activate it, but a positioning is a statement of intent, so say what you drafted it from. In a repository it writes docs/weighing/sets/positioning.json; on a hosted project it records weighing.set.saved.",
      inputSchema: {
        type: "object",
        properties: {
          elements: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              properties: {
                id: { type: "string", description: "A value element id." },
                weight: { type: "number", exclusiveMinimum: 0, description: "How much the product stands on it. Default 1." },
                anchors: { type: "object", additionalProperties: { type: "string" }, description: 'Level -> description in the product\'s words, keyed by the level as a string ("3", "0", "-3").' },
              },
              required: ["id"],
              additionalProperties: false,
            },
          },
          status: { type: "string", enum: ["draft", "active"], description: "Default: draft." },
          title: { type: "string" },
        },
        required: ["elements"],
        additionalProperties: false,
      },
    },
    async (args) => {
      if (!Array.isArray(args.elements) || args.elements.length === 0) throw new ToolError("`elements` is required: at least one element of value.");
      const status = optionalString(args, "status") ?? "draft";
      if (status !== "draft" && status !== "active") throw new ToolError("`status` must be draft or active.");

      const graph = await load();
      const section = sectionOf(graph);
      const ruler = buildWeighingContext(section)?.set;
      if (ruler === undefined) throw new ToolError(`The built-in set "${VALUE_SET_ID}" is not available.`);

      const set: WeighingCriteriaSet = {
        id: POSITIONING_SET_ID,
        version: "1.0.0",
        title: optionalString(args, "title") ?? "Positioning",
        subject: ruler.subject,
        scale: weighingScaleOf(ruler),
        role: "positioning",
        status,
        extends: `${ruler.id}@${ruler.version.split(".")[0]}`,
        // Passed through AS GIVEN: a weight that is a string, an anchor off the scale or an entry that is not an
        // object is the planner's to refuse (`invalid_set`, with the reason), not this tool's to quietly fix.
        criteria: (args.elements as unknown[]).map((entry) =>
          typeof entry === "object" && entry !== null && !Array.isArray(entry)
            ? ({
                id: (entry as Record<string, unknown>).id,
                ...((entry as Record<string, unknown>).weight !== undefined ? { weight: (entry as Record<string, unknown>).weight } : {}),
                ...((entry as Record<string, unknown>).anchors !== undefined ? { anchors: (entry as Record<string, unknown>).anchors } : {}),
              } as WeighingCriteriaSet["criteria"][number])
            : (entry as WeighingCriteriaSet["criteria"][number]),
        ),
      };
      const input: WeighingEventInput = { type: WEIGHING_SET_SAVED, set };

      const notes = status === "draft" ? ["Saved as a draft: it feeds no roll-up until it is saved as active."] : [];
      if (ctx.qualityRoot === undefined) {
        const events = await appendHosted([input]);
        return { positioning: set, events, ...(notes.length > 0 ? { notes } : {}) };
      }
      const plan = planWeighingEvents(section, graph.nodes as Node[], [input], { actor: MCP_ACTOR, scorerKind: "agent" });
      if (!plan.ok) throw new ToolError(`Positioning refused — ${plan.refusals.map((r) => `${r.reason}: ${r.detail}`).join("; ")}`, { refusals: plan.refusals });
      try {
        saveWeighingSet(ctx.qualityRoot, set);
      } catch (error) {
        throw new ToolError((error as Error).message);
      }
      return { positioning: set, file: weighingSetPath(ctx.qualityRoot, set.id), ...(notes.length > 0 ? { notes } : {}) };
    },
  );

  return { tools, handlers };
}
