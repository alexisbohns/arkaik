/**
 * The decision half of the tool catalog (docs/rfcs/stake-architecture.md § 14,
 * parts B and D) — `decide_option` records that one option was chosen to answer a
 * stake, and `stake_proof` reads where a stake stands.
 *
 * **The agent supplies the judgement, the planner writes it down.** Which option
 * wins, and why each other one lost, is a choice, so the caller states it.
 * `planSelectOption` (`@arkaik/schema`'s option.ts) turns it into a decision, its
 * `impacts` edge to the stake and its `generates` edge to the option, closing
 * every other option with a reason. Whether an option is selected or closed is
 * then read from that decision, never stored on the option.
 *
 * **Op-only, so it works hosted.** The tool writes nodes and edges, never a
 * journal-only event, so a hosted session can use it. It goes through the same
 * `applyOps` and validator-gated persist as every other writer, and the server
 * stamps the actor: there is no `actor` argument. With `supersede`, the earlier
 * decision moves to superseded through an ordinary node update, so the journal
 * records `decision.status_changed`.
 *
 * **`stake_proof` only reads.** It hands `deriveStakeProof` (`@arkaik/schema`'s
 * stake-proof.ts) the nodes, the edges, the journal, the quality section, the
 * Kritik library and the weighing section as this session sees them (the
 * sidecars in a repo, the server's fold when hosted), and the clock. Nothing is
 * written, so it works hosted and in a repo alike.
 */

import {
  STAKE_STATES,
  deriveStakeProof,
  deriveStakeProofs,
  planSelectOption,
  resolveKritikLibrary,
  resolveProducts,
  type ClosedOption,
  type KritikLibrary,
  type QualitySection,
  type StakeProof,
  type WeighingSection,
} from "@arkaik/schema";
import { loadCurrentQualitySection } from "@arkaik/schema/src/cli/kritik-audit";
import { loadWeighingSection } from "@arkaik/schema/src/cli/weighing-files";
import { loadKritikLibrary } from "arkaik/io";
import { ToolError, type ToolDefinition, type ToolHandler } from "./protocol";
import type { QualifyIo, QualifyToolContext } from "./qualify-tools";
import type { LoadedGraph } from "./tools";

export interface DecideToolContext extends QualifyToolContext {
  /** The repo root holding `docs/quality/` and `docs/weighing/`, or `undefined` when hosted. */
  qualityRoot?: string;
}
export type DecideIo = QualifyIo;

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.trim() === "") throw new ToolError(`\`${key}\` is required.`);
  return value;
}

const ISO_8601 = /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/** True for an ISO 8601 date or date-time that names a real day. `Date.parse` alone also takes "1" and "Nov 22", and rolls "2026-02-30" over to March. */
function isIsoDate(value: string): boolean {
  const match = ISO_8601.exec(value);
  if (match === null || !Number.isFinite(Date.parse(value))) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const real = new Date(Date.UTC(year, month - 1, day));
  return real.getUTCFullYear() === year && real.getUTCMonth() === month - 1 && real.getUTCDate() === day;
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new ToolError(`\`${key}\` must be a string.`);
  return value.trim() === "" ? undefined : value;
}

/** `closed` as the caller passed it: an array of `{ option_id, reason }`. A missing reason is allowed (the planner defaults it and says so); anything else malformed is refused. */
function readClosed(args: Record<string, unknown>): ClosedOption[] | undefined {
  const raw = args.closed;
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) throw new ToolError("`closed` must be an array of { option_id, reason }.");
  return raw.map((entry: unknown, index) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) throw new ToolError(`closed[${index}] must be an object with an option_id.`);
    const { option_id, reason } = entry as { option_id?: unknown; reason?: unknown };
    if (typeof option_id !== "string" || option_id === "") throw new ToolError(`closed[${index}].option_id is required.`);
    if (reason !== undefined && typeof reason !== "string") throw new ToolError(`closed[${index}].reason must be a string.`);
    return { option_id, reason: reason ?? "" };
  });
}

/** Today, as the ISO date a decision is taken on. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The quality section, its library and the weighing section as this session
 * sees them: the sidecars in a repo (falling back to what the bundle embeds),
 * the server's fold when hosted. Any of them may be absent, and an unreadable
 * sidecar is the same as an absent one: the proof reader degrades without it.
 */
function proofSources(ctx: DecideToolContext, graph: LoadedGraph): { quality?: QualitySection; library?: KritikLibrary; weighing?: WeighingSection } {
  const bundle = graph.loaded.bundle as { quality?: QualitySection; weighing?: WeighingSection };
  const embedded = bundle.quality !== undefined && Array.isArray(bundle.quality.findings) && Array.isArray(bundle.quality.assessments) ? bundle.quality : undefined;
  if (ctx.qualityRoot === undefined) {
    return {
      ...(embedded !== undefined ? { quality: embedded, library: resolveKritikLibrary(embedded) } : {}),
      ...(bundle.weighing !== undefined ? { weighing: bundle.weighing } : {}),
    };
  }
  let library: KritikLibrary | undefined;
  let quality: QualitySection | undefined;
  let weighing: WeighingSection | undefined;
  try {
    library = loadKritikLibrary(ctx.qualityRoot).library;
    quality = loadCurrentQualitySection(ctx.qualityRoot, library);
  } catch {
    // No pack or no audit on disk: the proof reads what the bundle embeds, then without.
  }
  try {
    weighing = loadWeighingSection(ctx.qualityRoot);
  } catch {
    // No weighing sidecars: "considered" reads without them.
  }
  quality ??= embedded;
  library ??= embedded === undefined ? undefined : resolveKritikLibrary(embedded);
  weighing ??= bundle.weighing;
  return { ...(quality !== undefined ? { quality } : {}), ...(library !== undefined ? { library } : {}), ...(weighing !== undefined ? { weighing } : {}) };
}

export function buildDecideCatalog(
  ctx: DecideToolContext,
  io: DecideIo,
): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [];
  const handlers: Record<string, ToolHandler> = {};
  const tool = (definition: ToolDefinition, handler: ToolHandler): void => {
    tools.push(definition);
    handlers[definition.name] = handler;
  };

  tool(
    {
      name: "decide_option",
      description:
        "Record that one option was chosen to answer a stake. Creates a decision (approved by default; `status: enacted` when the work is already done) with `reason` as its context, an `impacts` edge to the stake and a `generates` edge to the option. Every other non-archived option addressing the stake is closed in the decision's `closed_options`: name a reason for each loser in `closed`, or it gets a default reason and is handed back to a human. The option must address the stake and must not be archived. A stake that already has an approved or enacted decision is refused unless `supersede: true`, which moves that decision to superseded (the journal records the change) and links the new one to it. The server stamps the author; `decided_at` defaults to today. Whether an option is selected or closed is read from the decision, never stored on the option. Works on a repo and a hosted project.",
      inputSchema: {
        type: "object",
        properties: {
          stake_id: { type: "string", description: "The stake the decision settles." },
          option_id: { type: "string", description: "The option chosen. It must address the stake." },
          reason: { type: "string", description: "Why this option: the decision's context. Required." },
          closed: {
            type: "array",
            description: "Why each loser lost. Options not named here are still closed, with a default reason.",
            items: {
              type: "object",
              properties: {
                option_id: { type: "string", description: "An option that addresses the same stake." },
                reason: { type: "string", description: "Why it lost." },
              },
              required: ["option_id"],
              additionalProperties: false,
            },
          },
          title: { type: "string", description: 'The decision\'s title. Default: Select "<option>" for "<stake>".' },
          status: { type: "string", enum: ["approved", "enacted"], description: "Default approved." },
          supersede: { type: "boolean", description: "Replace the stake's existing approved or enacted decision. Required when there is one." },
          decided_at: { type: "string", description: "An ISO 8601 date. Default today." },
        },
        required: ["stake_id", "option_id", "reason"],
        additionalProperties: false,
      },
    },
    async (args) => {
      const graph = await io.load();
      const status = optionalString(args, "status");
      if (status !== undefined && status !== "approved" && status !== "enacted") throw new ToolError("`status` must be approved or enacted.");
      const decidedAt = optionalString(args, "decided_at") ?? today();
      if (!isIsoDate(decidedAt)) throw new ToolError("`decided_at` must be an ISO 8601 date.");
      if (args.supersede !== undefined && typeof args.supersede !== "boolean") throw new ToolError("`supersede` must be a boolean.");
      const closed = readClosed(args);
      const title = optionalString(args, "title");

      const plan = planSelectOption({
        projectId: graph.project.id,
        stakeId: requireString(args, "stake_id"),
        optionId: requireString(args, "option_id"),
        reason: requireString(args, "reason"),
        decidedAt,
        nodes: graph.nodes,
        edges: graph.edges,
        ...(closed !== undefined ? { closed } : {}),
        ...(title !== undefined ? { title } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(args.supersede === true ? { supersede: true } : {}),
      });
      if (plan.action === "refused") throw new ToolError(`Not decided: ${plan.reasons.join(" ")}`, { reasons: plan.reasons });

      const outcome = io.mutate(graph, plan.ops);
      const result = await ctx.store.persist(graph, { nodes: outcome.nodes, edges: outcome.edges, ops: plan.ops }, outcome.eventInputs);
      const { warnings, events } = io.unwrap(result);
      const decisionId = plan.decision_id as string;
      return {
        action: plan.action,
        decision_id: decisionId,
        decision: outcome.nodes.find((node) => node.id === decisionId),
        reasons: plan.reasons,
        ops: plan.ops,
        events,
        warnings,
        handToHuman: plan.handToHuman,
      };
    },
  );

  tool(
    {
      name: "stake_proof",
      description:
        "Read-only. Where a stake stands, derived and never stored: its state (raised, considered, promised, verified-not-delivered, partly-addressed, addressed; null for an archived stake), the answer a decision chose, the definition of done, and one cell per platform concerned saying whether the verified half holds (an acceptance at releasing or live), the answer is delivered (live) or the verification is stale (its reverify_every_days ran out, or the Kritik criterion moved to a newer version). A requirement is read against its Kritik criterion: no open finding at its anchor and a score of at least 3 dated after the stake was raised. Pass stake_id for one stake, or leave it off for every stake with a count per state. product narrows the platforms to a product's menu; now (ISO 8601) defaults to the server's clock. Never writes. Works on a repo and a hosted project.",
      inputSchema: {
        type: "object",
        properties: {
          stake_id: { type: "string", description: "One stake. Leave off for every stake." },
          product: { type: "string", description: "A product id declared in the project: read the platforms through its menu. Default: all products." },
          now: { type: "string", description: "An ISO 8601 instant to read the expiry against. Default: the server's clock." },
        },
        additionalProperties: false,
      },
    },
    async (args) => {
      const graph = await io.load();
      const stakeId = optionalString(args, "stake_id");
      const product = optionalString(args, "product");
      const nowArg = optionalString(args, "now");
      if (product !== undefined) {
        const known = resolveProducts(graph.project).map((entry) => entry.id);
        if (!known.includes(product)) {
          throw new ToolError(known.length === 0 ? `This project declares no products, so \`product\` "${product}" names none.` : `No product "${product}" (declared: ${known.join(", ")}).`);
        }
      }
      if (nowArg !== undefined && !isIsoDate(nowArg)) throw new ToolError("`now` must be an ISO 8601 date or date-time.");
      const now = nowArg !== undefined ? new Date(nowArg) : new Date();
      const input = {
        nodes: graph.nodes,
        edges: graph.edges,
        events: graph.journal,
        now,
        project: graph.project,
        productId: product ?? null,
        ...proofSources(ctx, graph),
      };
      const common = { now: now.toISOString(), product: product ?? null };
      if (stakeId !== undefined) {
        const proof = deriveStakeProof({ ...input, stakeId });
        if (proof === null) {
          const found = graph.nodes.find((node) => node.id === stakeId);
          throw new ToolError(found === undefined ? `No node with id "${stakeId}".` : `"${stakeId}" is a ${found.species}, not a stake.`);
        }
        return { ...common, stake: proof };
      }
      const stakes: StakeProof[] = deriveStakeProofs(input);
      const counts: Record<string, number> = Object.fromEntries([...STAKE_STATES, "archived"].map((state) => [state, 0]));
      for (const proof of stakes) counts[proof.state ?? "archived"]++;
      return { ...common, count: stakes.length, counts, stakes };
    },
  );

  return { tools, handlers };
}
