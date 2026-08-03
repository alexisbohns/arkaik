#!/usr/bin/env node

/**
 * Ref-driven status promotion (packages/schema/src/promote.ts).
 *
 * The rule this module must not break: docs/spec/bundle-format.md says
 * `status_mapped` never overwrites `node.status` automatically. Promotion is
 * therefore OPT-IN per project, and the first assertion below is that a project
 * which has not opted in gets nothing at all — every other behaviour here is
 * only reachable after a recorded decision in the bundle.
 *
 * The per-platform behaviour is the other load-bearing part: an acceptance
 * shipped on one platform must NOT read as shipped everywhere, or the parity
 * gap projection (#277) would report parity the product does not have.
 */

const { loadSchema } = require("./load-schema");

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS: ${name}`);
  } else {
    failures++;
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function acceptance(id, extra = {}) {
  return {
    id,
    project_id: "p",
    species: "acceptance",
    title: id,
    status: "backlog",
    platforms: ["web", "ios"],
    ...extra,
  };
}

function ref(overrides = {}) {
  return {
    id: "gh-1",
    type: "github-pr",
    url: "https://github.com/o/r/pull/1",
    external_status: "merged",
    ...overrides,
  };
}

function bundle(nodes, policy) {
  return {
    schema_version: 2,
    project: {
      id: "p",
      title: "T",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      ...(policy === undefined ? {} : { metadata: { ref_policy: policy } }),
    },
    nodes,
    edges: [],
  };
}

function main() {
  const { computeRefPromotions, promotionPatch, resolveRefPolicy, DEFAULT_REF_POLICY } = loadSchema();

  // --- Opt-in is the whole contract ---------------------------------------
  {
    const withRef = acceptance("AC-a", { metadata: { refs: [ref()] } });
    const plan = computeRefPromotions(bundle([withRef]));
    check(
      "a project that has not opted in promotes NOTHING",
      plan.promotions.length === 0,
      JSON.stringify(plan.promotions),
    );
    check("and reports no skips either (the feature is simply off)", plan.skipped.length === 0);
    check("resolveRefPolicy returns null without opt-in", resolveRefPolicy(bundle([withRef])) === null);
  }
  {
    const withRef = acceptance("AC-a", { metadata: { refs: [ref()] } });
    check(
      "`ref_policy: true` is shorthand for the defaults",
      JSON.stringify(resolveRefPolicy(bundle([withRef], true))) === JSON.stringify(DEFAULT_REF_POLICY),
    );
    const plan = computeRefPromotions(bundle([withRef], true));
    check("opting in with the shorthand promotes", plan.promotions.length === 1);
    check("a merged PR means live", plan.promotions[0]?.to === "live", JSON.stringify(plan.promotions[0]));
    check("the promotion records where it came from", plan.promotions[0]?.from === "backlog");
  }

  // --- The default mapping -------------------------------------------------
  {
    const open = acceptance("AC-o", { metadata: { refs: [ref({ external_status: "open" })] } });
    const plan = computeRefPromotions(bundle([open], true));
    check("an open PR means development", plan.promotions[0]?.to === "development");
  }
  {
    const closed = acceptance("AC-c", { metadata: { refs: [ref({ external_status: "closed" })] } });
    const plan = computeRefPromotions(bundle([closed], true));
    check(
      "a PR closed WITHOUT merging moves nothing (null mapping)",
      plan.promotions.length === 0,
      JSON.stringify(plan.promotions),
    );
    check("and a null mapping is not reported as a gap", plan.skipped.length === 0, JSON.stringify(plan.skipped));
  }
  {
    const odd = acceptance("AC-x", { metadata: { refs: [ref({ external_status: "draft" })] } });
    const plan = computeRefPromotions(bundle([odd], true));
    check("an unmapped external status is skipped, not guessed", plan.promotions.length === 0);
    check("and the skip names the status", plan.skipped[0]?.reason === "no-mapping" && plan.skipped[0]?.detail === "draft");
  }

  // --- Per-platform is the point ------------------------------------------
  {
    const scoped = acceptance("AC-p", { metadata: { refs: [ref({ platform: "ios" })] } });
    const plan = computeRefPromotions(bundle([scoped], true));
    check("a platform-scoped ref promotes that platform", plan.promotions[0]?.platform === "ios");

    const patch = promotionPatch(scoped, plan.promotions[0]);
    check("the patch targets platformStatuses, not status", patch.status === undefined);
    check("and sets only that platform", patch.metadata?.platformStatuses?.ios === "live");
    check(
      "leaving the other platform untouched (so parity gaps stay honest)",
      patch.metadata?.platformStatuses?.web === undefined,
      JSON.stringify(patch.metadata?.platformStatuses),
    );
  }
  {
    const unscoped = acceptance("AC-u", { metadata: { refs: [ref()] } });
    const patch = promotionPatch(unscoped, computeRefPromotions(bundle([unscoped], true)).promotions[0]);
    check("an unscoped ref moves the base status", patch.status === "live");
    check("and does not invent platformStatuses", patch.metadata === undefined);
  }
  {
    // validateBundle errors on a platformStatuses key outside `platforms`, so
    // this must be reported rather than written.
    const wrongPlatform = acceptance("AC-w", {
      platforms: ["web"],
      metadata: { refs: [ref({ platform: "android" })] },
    });
    const plan = computeRefPromotions(bundle([wrongPlatform], true));
    check("a ref naming an inapplicable platform promotes nothing", plan.promotions.length === 0);
    check(
      "and says why",
      plan.skipped[0]?.reason === "platform-not-applicable" && plan.skipped[0]?.detail === "android",
      JSON.stringify(plan.skipped),
    );
  }

  // --- Guards --------------------------------------------------------------
  {
    const archived = acceptance("AC-arch", { status: "archived", metadata: { refs: [ref()] } });
    const plan = computeRefPromotions(bundle([archived], true));
    check("an archived node is never resurrected by a stale PR", plan.promotions.length === 0);
    check("and the skip says archived", plan.skipped[0]?.reason === "archived");
  }
  {
    const alreadyLive = acceptance("AC-live", { status: "live", metadata: { refs: [ref()] } });
    const plan = computeRefPromotions(bundle([alreadyLive], true));
    check("a node already at the target is not re-promoted", plan.promotions.length === 0);
    check("so a re-run is a no-op, not a churn of events", plan.skipped[0]?.reason === "already-there");
  }
  {
    const scopedLive = acceptance("AC-sl", {
      metadata: { platformStatuses: { ios: "live" }, refs: [ref({ platform: "ios" })] },
    });
    const plan = computeRefPromotions(bundle([scopedLive], true));
    check(
      "already-there is judged per platform, not on the base status",
      plan.promotions.length === 0 && plan.skipped[0]?.reason === "already-there",
      JSON.stringify(plan),
    );
  }

  // --- A custom policy overrides the defaults ------------------------------
  {
    const node = acceptance("AC-cust", { metadata: { refs: [ref({ external_status: "merged" })] } });
    const plan = computeRefPromotions(bundle([node], { "github-pr": { merged: "releasing" } }));
    check("a custom policy is honoured", plan.promotions[0]?.to === "releasing");
  }
  {
    const node = acceptance("AC-none", { metadata: { refs: [ref()] } });
    const plan = computeRefPromotions(bundle([node], { "linear-issue": { done: "live" } }));
    check("a policy that does not mention this ref type promotes nothing", plan.promotions.length === 0);
  }

  // --- Hand-written policies may speak the pre-v3 vocabulary ---------------
  {
    const node = acceptance("AC-leg", { status: "idea", metadata: { refs: [ref({ external_status: "open" })] } });
    const plan = computeRefPromotions(bundle([node], { "github-pr": { open: "prioritized" } }));
    check(
      "a legacy policy target is honoured at its current-status meaning",
      plan.promotions[0]?.to === "backlog",
      JSON.stringify(plan),
    );
  }
  {
    const node = acceptance("AC-typo", { metadata: { refs: [ref()] } });
    const plan = computeRefPromotions(bundle([node], { "github-pr": { merged: "shipped" } }));
    check("a policy target outside both vocabularies promotes nothing", plan.promotions.length === 0);
    check(
      "and the skip names the unknown status",
      plan.skipped[0]?.reason === "no-mapping" && plan.skipped[0]?.detail === "unknown status: shipped",
      JSON.stringify(plan.skipped),
    );
  }

  // --- Refs without a mirrored status --------------------------------------
  {
    const unsynced = acceptance("AC-un", { metadata: { refs: [ref({ external_status: undefined })] } });
    const plan = computeRefPromotions(bundle([unsynced], true));
    check("a ref never synced promotes nothing", plan.promotions.length === 0);
  }

  // --- Non-acceptance nodes are eligible too -------------------------------
  {
    const view = {
      id: "V-a",
      project_id: "p",
      species: "view",
      title: "A",
      status: "backlog",
      platforms: ["web"],
      metadata: { refs: [ref()] },
    };
    const plan = computeRefPromotions(bundle([view], true));
    check(
      "promotion is not acceptance-only — any node with a ref qualifies",
      plan.promotions.length === 1 && plan.promotions[0].node_id === "V-a",
    );
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll promote checks passed.");
}

main();
