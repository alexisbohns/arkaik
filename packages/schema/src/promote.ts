/**
 * Ref-driven status promotion — turning "this PR merged" into "this acceptance
 * shipped" (docs/spec/bundle-format.md § References).
 *
 * ── The rule this deliberately does not break ───────────────────────────────
 * The format says: *"`status_mapped` never overwrites `node.status`
 * automatically; it is advisory display data."* That default stands. A project
 * opts in by declaring `project.metadata.ref_policy`, and only then does a
 * mirrored ref status move a node. Absent policy = today's behaviour exactly,
 * so nothing that exists changes meaning.
 *
 * Opting in is what makes the promotion honest rather than surprising: it is a
 * recorded decision in the bundle, visible in a diff, not an implicit behaviour
 * of the tooling.
 *
 * ── Per-platform, because acceptances are ──────────────────────────────────
 * A ref may carry a `platform`. When it does, the promotion moves that
 * platform's entry in `metadata.platformStatuses` and leaves the others alone —
 * so a PR in an iOS repo marks iOS shipped and `computeParityGaps` correctly
 * reports Web and Android as lagging. Moving the base `status` instead would
 * silently claim parity the product does not have.
 *
 * Zod-free (type-only imports) like validate.ts / acceptance.ts / mutate.ts.
 */

import type { Node, ProjectBundle, Ref } from "./bundle";
import type { PlatformId, StatusId } from "./ids";

/**
 * Which node status each mirrored external status implies, per ref type.
 *
 * `null` means "this transition moves nothing" — the way to say, for instance,
 * that a PR closed without merging should leave the acceptance where it is
 * rather than reverting work someone may still be doing.
 */
export interface RefPolicy {
  [refType: string]: Record<string, StatusId | null> | undefined;
}

/**
 * The policy a project gets when it opts in without naming one. PR opened →
 * being worked on; merged → shipped; closed → deliberately nothing.
 */
export const DEFAULT_REF_POLICY: RefPolicy = {
  "github-pr": { open: "development", merged: "live", closed: null },
  "gitlab-mr": { open: "development", merged: "live", closed: null },
};

export interface Promotion {
  node_id: string;
  ref_id: string;
  /** Present when the ref is platform-scoped; the promotion then targets that platform only. */
  platform?: PlatformId;
  from: StatusId;
  to: StatusId;
  /** The mirrored external status that implied this move. */
  external_status: string;
}

/** Why a candidate promotion was skipped — surfaced so a no-op is explainable. */
export interface SkippedPromotion {
  node_id: string;
  ref_id: string;
  reason: "platform-not-applicable" | "archived" | "already-there" | "no-mapping";
  detail?: string;
}

export interface PromotionPlan {
  promotions: Promotion[];
  skipped: SkippedPromotion[];
}

/** The effective policy for a bundle, or null when the project has not opted in. */
export function resolveRefPolicy(bundle: Pick<ProjectBundle, "project">): RefPolicy | null {
  const declared = (bundle.project.metadata as { ref_policy?: unknown } | undefined)?.ref_policy;
  if (declared === undefined) return null;
  // `ref_policy: true` is the shorthand for "use the defaults".
  if (declared === true) return DEFAULT_REF_POLICY;
  if (typeof declared !== "object" || declared === null || Array.isArray(declared)) return null;
  return declared as RefPolicy;
}

/** The status a node currently has for the scope a ref targets. */
function currentStatus(node: Node, platform?: PlatformId): StatusId {
  if (!platform) return node.status;
  return node.metadata?.platformStatuses?.[platform] ?? node.status;
}

/**
 * The status changes a bundle's mirrored refs imply under its policy.
 *
 * Pure: it computes a plan and changes nothing. Applying it is the caller's
 * job, through the normal mutation path, so every promotion lands as an
 * ordinary `node.status_changed` event with a real actor — never a silent
 * rewrite.
 */
export function computeRefPromotions(bundle: ProjectBundle): PromotionPlan {
  const policy = resolveRefPolicy(bundle);
  const promotions: Promotion[] = [];
  const skipped: SkippedPromotion[] = [];
  if (!policy) return { promotions, skipped };

  for (const node of bundle.nodes) {
    const refs = node.metadata?.refs;
    if (!Array.isArray(refs) || refs.length === 0) continue;

    for (const ref of refs as Ref[]) {
      const mapping = policy[ref.type];
      if (!mapping) continue;
      if (!ref.external_status) continue;

      const target = mapping[ref.external_status];
      if (target === undefined) {
        skipped.push({ node_id: node.id, ref_id: ref.id, reason: "no-mapping", detail: ref.external_status });
        continue;
      }
      // An explicit null means "recognised, moves nothing" — not a gap.
      if (target === null) continue;

      // Archived is a deliberate end state; a stale PR must not resurrect it.
      if (node.status === "archived") {
        skipped.push({ node_id: node.id, ref_id: ref.id, reason: "archived" });
        continue;
      }

      // `validateBundle` errors on a platformStatuses key outside `platforms`,
      // so a ref naming an inapplicable platform is reported, never written.
      if (ref.platform && !node.platforms.includes(ref.platform)) {
        skipped.push({
          node_id: node.id,
          ref_id: ref.id,
          reason: "platform-not-applicable",
          detail: ref.platform,
        });
        continue;
      }

      const from = currentStatus(node, ref.platform);
      if (from === target) {
        skipped.push({ node_id: node.id, ref_id: ref.id, reason: "already-there", detail: target });
        continue;
      }

      promotions.push({
        node_id: node.id,
        ref_id: ref.id,
        ...(ref.platform ? { platform: ref.platform } : {}),
        from,
        to: target,
        external_status: ref.external_status,
      });
    }
  }

  return { promotions, skipped };
}

/**
 * The node patch a promotion implies — platform-scoped when the ref is.
 *
 * Returned as a patch rather than applied, so the caller runs it through
 * `applyOps` and gets the usual derived events (a platform-scoped change emits
 * `node.status_changed` carrying its `platform`).
 */
export function promotionPatch(node: Node, promotion: Promotion): Partial<Node> {
  if (!promotion.platform) return { status: promotion.to };
  return {
    metadata: {
      ...node.metadata,
      platformStatuses: { ...node.metadata?.platformStatuses, [promotion.platform]: promotion.to },
    },
  };
}
