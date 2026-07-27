import "server-only";

import { applyOps, computeRefPromotions, promotionPatch, type MutationOp, type Node, type Ref } from "@arkaik/schema";

import { query } from "@/lib/services/db";
import { applyMutation, getProject } from "@/lib/services/graph/store";

/**
 * Turning a `pull_request` webhook into acceptance status changes.
 *
 * The shape of the work, in order:
 *   1. resolve the repo to the projects that linked it (and the platform each
 *      link declares);
 *   2. find the nodes whose refs point at this PR — attaching one if the PR
 *      body names an acceptance and no ref exists yet;
 *   3. mirror the PR's state onto those refs;
 *   4. compute promotions under the project's opted-in policy and apply them.
 *
 * Every write goes through `applyMutation`, so a webhook-driven change is
 * subject to the same validator gate and lands the same journal events as a
 * human edit — with `github-app` as the actor, so the history says what acted.
 */

/** `AC-…` mentioned in a PR body or title. Bounded to the id charset. */
const ACCEPTANCE_MENTION = /\bAC-[a-z0-9][a-z0-9-]*/gi;

export interface PullRequestEvent {
  action: string;
  repoFullName: string;
  number: number;
  url: string;
  title: string;
  body: string;
  merged: boolean;
  state: string;
}

export interface LinkedRepo {
  projectId: string;
  platform: string | null;
}

/**
 * The external status a PR is in, matching what `arkaik sync` computes from the
 * REST API — so the webhook and the CLI can never disagree about what "merged"
 * means for the same PR.
 */
export function prExternalStatus(event: Pick<PullRequestEvent, "merged" | "state">): string {
  if (event.merged) return "merged";
  return event.state === "closed" ? "closed" : "open";
}

/** Projects that linked this repo. Lowercased: GitHub is case-insensitive here. */
export async function linkedProjects(repoFullName: string): Promise<LinkedRepo[]> {
  const { rows } = await query<{ project_id: string; platform: string | null }>(
    `select project_id, platform
       from project_repos
      where provider = 'github' and repo_full_name = $1`,
    [repoFullName.toLowerCase()],
  );
  return rows.map((row) => ({ projectId: row.project_id, platform: row.platform }));
}

/**
 * Record a delivery, returning false if it was already seen.
 *
 * GitHub retries failed deliveries and offers a manual redeliver button, so
 * without this a retry after a partially-successful run would re-apply
 * transitions. Insert-first (rather than check-then-insert) makes the guard
 * atomic under concurrent deliveries.
 */
export async function claimDelivery(deliveryId: string): Promise<boolean> {
  const { rows } = await query<{ delivery_id: string }>(
    `insert into github_deliveries (delivery_id) values ($1)
     on conflict (delivery_id) do nothing
     returning delivery_id`,
    [deliveryId],
  );
  if (rows.length === 0) return false;

  // Opportunistic prune — GitHub cannot replay a delivery older than a day.
  await query(`delete from github_deliveries where received_at < now() - interval '2 days'`);
  return true;
}

/**
 * Give a claimed delivery back after a failed apply, so GitHub's retry can
 * redo it. Without this, claiming before applying would turn any transient
 * failure into a permanently lost transition: the retry would arrive, see the
 * claim, and skip.
 *
 * Releasing is safe because applying twice is a no-op by construction —
 * re-writing an identical ref derives no events (`diffNodeUpdate`), and a
 * promotion to a status the node already holds is skipped as `already-there`.
 * The ledger prevents wasted work, not incorrectness.
 */
export async function releaseDelivery(deliveryId: string): Promise<void> {
  await query(`delete from github_deliveries where delivery_id = $1`, [deliveryId]);
}

/** A stable, readable ref id for a PR: `gh-pr-<number>`. */
export function refIdFor(number: number): string {
  return `gh-pr-${number}`;
}

/** Acceptance ids named in a PR's title or body, deduped and upper-cased. */
export function mentionedAcceptances(event: Pick<PullRequestEvent, "title" | "body">): string[] {
  const found = new Set<string>();
  for (const text of [event.title, event.body]) {
    if (!text) continue;
    for (const match of text.matchAll(ACCEPTANCE_MENTION)) {
      // Node ids are case-sensitive; `AC-` is the canonical prefix, and the rest
      // is kebab-case by `deriveNodeId`, so normalise the prefix only.
      found.add(`AC-${match[0].slice(3)}`);
    }
  }
  return [...found];
}

interface NodeWithRefs extends Node {
  metadata?: Node["metadata"] & { refs?: Ref[] };
}

/**
 * The ops that bring one project in line with a PR event: attach the ref where
 * a mention names an uncovered acceptance, mirror the PR's state onto matching
 * refs, then promote under the project's policy.
 *
 * Returns an empty list when nothing applies, which is the common case — most
 * PRs in a linked repo mention no acceptance at all.
 */
export function planForProject(
  bundle: { project: { metadata?: Record<string, unknown> }; nodes: Node[]; edges: unknown[] },
  event: PullRequestEvent,
  platform: string | null,
): MutationOp[] {
  const ops: MutationOp[] = [];
  const refId = refIdFor(event.number);
  const externalStatus = prExternalStatus(event);
  const now = new Date().toISOString();

  const nodes = bundle.nodes as NodeWithRefs[];
  const mentioned = new Set(mentionedAcceptances(event));

  // A node is in scope if it already references this PR, or if the PR names it.
  const targets = nodes.filter(
    (node) =>
      node.metadata?.refs?.some((r) => r.id === refId || r.url === event.url) || mentioned.has(node.id),
  );

  const patched: Node[] = [];
  for (const node of targets) {
    const refs = [...(node.metadata?.refs ?? [])];
    const index = refs.findIndex((r) => r.id === refId || r.url === event.url);

    const nextRef: Ref = {
      id: refId,
      type: "github-pr",
      url: event.url,
      title: event.title,
      external_status: externalStatus,
      synced_at: now,
      // Only scope the ref when the LINK declares a platform and the node
      // actually has it — otherwise the promotion would be refused later, and a
      // ref claiming a platform the node lacks is simply wrong.
      ...(platform && node.platforms.includes(platform as Node["platforms"][number])
        ? { platform: platform as Node["platforms"][number] }
        : {}),
    };

    if (index === -1) refs.push(nextRef);
    else refs[index] = { ...refs[index], ...nextRef };

    const patch = { metadata: { ...node.metadata, refs } };
    ops.push({ op: "update_node", node_id: node.id, patch });
    patched.push({ ...node, ...patch } as Node);
  }

  if (patched.length === 0) return ops;

  // Promotions are computed against the graph AS IT WILL BE after the ref
  // updates above — the same batch, so the mirrored status and the status it
  // implies are never briefly inconsistent.
  const withPatches = nodes.map((node) => patched.find((p) => p.id === node.id) ?? node);
  const plan = computeRefPromotions({
    ...bundle,
    nodes: withPatches,
  } as Parameters<typeof computeRefPromotions>[0]);

  for (const promotion of plan.promotions) {
    if (promotion.ref_id !== refId) continue;
    const node = withPatches.find((n) => n.id === promotion.node_id);
    if (!node) continue;
    ops.push({ op: "update_node", node_id: node.id, patch: promotionPatch(node, promotion) });
  }

  return ops;
}

export interface ApplyOutcome {
  projectId: string;
  applied: number;
  skipped?: string;
}

/** Apply a PR event to every project that linked the repo. */
export async function applyPullRequestEvent(event: PullRequestEvent): Promise<ApplyOutcome[]> {
  const links = await linkedProjects(event.repoFullName);
  const outcomes: ApplyOutcome[] = [];

  for (const link of links) {
    // Owner scoping is by the link itself: a repo can only be linked by someone
    // who owns the project, so the webhook acts within that authority.
    const loaded = await getProject(link.projectId, await ownerIdsFor(link.projectId));
    if (!loaded) {
      outcomes.push({ projectId: link.projectId, applied: 0, skipped: "project not found" });
      continue;
    }

    const ops = planForProject(
      loaded.bundle as unknown as Parameters<typeof planForProject>[0],
      event,
      link.platform,
    );
    if (ops.length === 0) {
      outcomes.push({ projectId: link.projectId, applied: 0, skipped: "no matching acceptance" });
      continue;
    }

    const result = await applyMutation({
      projectId: link.projectId,
      ownerIds: await ownerIdsFor(link.projectId),
      ops,
      actor: "github-app",
      tier: "klub", // A webhook must not fail on a tier cap it cannot act on.
    });

    outcomes.push({
      projectId: link.projectId,
      applied: result.ok ? ops.length : 0,
      ...(result.ok ? {} : { skipped: describeFailure(result) }),
    });
  }

  return outcomes;
}

/** The owner of a project, as a single-element list for the store's API. */
async function ownerIdsFor(projectId: string): Promise<string[]> {
  const { rows } = await query<{ owner_id: string }>(
    `select owner_id from graph_projects where id = $1`,
    [projectId],
  );
  return rows.map((row) => row.owner_id);
}

function describeFailure(result: { reason: string } & Record<string, unknown>): string {
  if (result.reason === "validation") return "refused by the validator";
  if (result.reason === "mutation") return `refused: ${String(result.code)}`;
  return result.reason;
}

export { applyOps };
