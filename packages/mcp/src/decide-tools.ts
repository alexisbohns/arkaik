/**
 * The decision half of the tool catalog (docs/rfcs/stake-architecture.md § 14,
 * part B) — `decide_option` records that one option was chosen to answer a stake.
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
 */

import { planSelectOption, type ClosedOption } from "@arkaik/schema";
import { ToolError, type ToolDefinition, type ToolHandler } from "./protocol";
import type { QualifyIo, QualifyToolContext } from "./qualify-tools";

export type DecideToolContext = QualifyToolContext;
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

  return { tools, handlers };
}
