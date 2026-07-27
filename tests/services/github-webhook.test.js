#!/usr/bin/env node

/**
 * The GitHub webhook (app/api/github/webhook, lib/services/github/*).
 *
 * This is the only endpoint that accepts a signed request from a third party,
 * and the first inbound signature check in the codebase, so the verification
 * assertions carry the most weight here:
 *
 *   - an unsigned request is rejected;
 *   - a WRONG signature is rejected (not merely a malformed one — a check that
 *     only rejects garbage is not a check);
 *   - a signature over DIFFERENT bytes is rejected, which is what catches an
 *     implementation that verifies a re-serialization instead of the raw body;
 *   - with no secret configured the endpoint refuses everything rather than
 *     accepting unauthenticated writes.
 *
 * Plus the planning logic: which nodes a PR touches, per-platform scoping from
 * the repo link, and idempotence — the property that lets a retry be safe.
 *
 * Runs against a real Postgres for the repo-link and delivery-ledger parts.
 */

const { Client } = require("pg");
const crypto = require("node:crypto");
const fs = require("node:fs");
const { loadGithubApi, BUILD_DIR } = require("./load-github-api");

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS: ${name}`);
  } else {
    failures++;
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const SECRET = "webhook-test-secret";
const REPO = "acme/ios-app";

function sign(body, secret = SECRET) {
  return `sha256=${crypto.createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

let deliveryCounter = 0;
function prPayload(overrides = {}) {
  return JSON.stringify({
    action: "closed",
    repository: { full_name: REPO },
    pull_request: {
      number: 42,
      html_url: "https://github.com/acme/ios-app/pull/42",
      title: "Guest checkout",
      body: "Implements AC-guest-checkout",
      merged: true,
      state: "closed",
      ...(overrides.pull_request ?? {}),
    },
    ...(overrides.top ?? {}),
  });
}

function webhookReq(body, { signature, event = "pull_request", delivery } = {}) {
  const headers = {
    "content-type": "application/json",
    "x-github-event": event,
    "x-github-delivery": delivery ?? `delivery-${++deliveryCounter}`,
  };
  if (signature !== null) headers["x-hub-signature-256"] = signature ?? sign(body);
  return new Request("https://arkaik.test/api/github/webhook", { method: "POST", headers, body });
}

function acceptance(id, platforms, extra = {}) {
  return {
    id,
    project_id: "gp",
    species: "acceptance",
    title: id,
    status: "prioritized",
    platforms,
    ...extra,
  };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set — this integration test needs a migrated Postgres.");
    process.exit(1);
  }
  process.env.GITHUB_WEBHOOK_SECRET = SECRET;
  // getCaller() refuses everyone unless auth is configured, so the repo-link
  // routes below would all 401 without these. NextAuth itself is stubbed; these
  // are never used for a real round-trip.
  process.env.AUTH_SECRET ||= "ghtest-secret";
  process.env.AUTH_GITHUB_ID ||= "ghtest-id";
  process.env.AUTH_GITHUB_SECRET ||= "ghtest-secret";

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const api = loadGithubApi();
  const { verify, pullRequest, POST } = api;

  try {
    // --- Signature verification (pure; no database needed) -----------------
    const body = prPayload();

    check("a correct signature verifies", verify.verifySignature(body, sign(body)).ok === true);
    check(
      "a missing signature is rejected",
      verify.verifySignature(body, null).reason === "missing-signature",
    );
    check(
      "a malformed signature is rejected",
      verify.verifySignature(body, "garbage").reason === "malformed-signature",
    );
    check(
      "a signature from the WRONG SECRET is rejected",
      verify.verifySignature(body, sign(body, "not-the-secret")).reason === "mismatch",
    );
    check(
      "a valid signature over DIFFERENT bytes is rejected",
      verify.verifySignature(body, sign(`${body} `)).reason === "mismatch",
      "catches verifying a re-serialization instead of the raw body",
    );
    {
      const saved = process.env.GITHUB_WEBHOOK_SECRET;
      delete process.env.GITHUB_WEBHOOK_SECRET;
      check(
        "with no secret configured, everything is refused",
        verify.verifySignature(body, sign(body)).reason === "unconfigured",
      );
      process.env.GITHUB_WEBHOOK_SECRET = saved;
    }

    // --- Route-level guards -------------------------------------------------
    check(
      "an unsigned request gets 401",
      (await POST(webhookReq(body, { signature: null }))).status === 401,
    );
    check(
      "a wrongly-signed request gets 401",
      (await POST(webhookReq(body, { signature: sign(body, "wrong") }))).status === 401,
    );
    check(
      "a request with no delivery id gets 400",
      (
        await POST(
          new Request("https://arkaik.test/api/github/webhook", {
            method: "POST",
            headers: { "x-github-event": "pull_request", "x-hub-signature-256": sign(body) },
            body,
          }),
        )
      ).status === 400,
    );
    {
      const res = await POST(webhookReq(body, { event: "ping" }));
      check("a ping is acknowledged, not acted on", res.status === 202, String(res.status));
    }
    {
      const ignored = prPayload({ top: { action: "labeled" } });
      const res = await POST(webhookReq(ignored));
      check("an uninteresting action is acknowledged", res.status === 202, String(res.status));
    }

    // --- Mention parsing ----------------------------------------------------
    check(
      "an acceptance id in the body is found",
      pullRequest.mentionedAcceptances({ title: "x", body: "closes AC-guest-checkout" })[0] ===
        "AC-guest-checkout",
    );
    check(
      "an acceptance id in the title is found",
      pullRequest.mentionedAcceptances({ title: "AC-a11y-labels: fix", body: "" })[0] === "AC-a11y-labels",
    );
    check(
      "duplicates collapse",
      pullRequest.mentionedAcceptances({ title: "AC-x", body: "AC-x again" }).length === 1,
    );
    check(
      "unrelated text yields nothing",
      pullRequest.mentionedAcceptances({ title: "chore: bump deps", body: "no ids here" }).length === 0,
    );

    // --- External status ----------------------------------------------------
    check("merged wins over state", pullRequest.prExternalStatus({ merged: true, state: "closed" }) === "merged");
    check("closed without merge is closed", pullRequest.prExternalStatus({ merged: false, state: "closed" }) === "closed");
    check("otherwise open", pullRequest.prExternalStatus({ merged: false, state: "open" }) === "open");

    // --- Planning: per-platform scoping from the LINK ------------------------
    const optedIn = {
      project: { id: "gp", title: "T", metadata: { ref_policy: true } },
      nodes: [acceptance("AC-guest-checkout", ["web", "ios"])],
      edges: [],
    };
    {
      const ops = pullRequest.planForProject(optedIn, JSON.parse(prPayload()) && {
        action: "closed",
        repoFullName: REPO,
        number: 42,
        url: "https://github.com/acme/ios-app/pull/42",
        title: "Guest checkout",
        body: "Implements AC-guest-checkout",
        merged: true,
        state: "closed",
      }, "ios");

      check("a mentioned acceptance gets ops", ops.length === 2, JSON.stringify(ops.map((o) => o.op)));
      const refOp = ops[0];
      check("the first op attaches the ref", refOp.patch.metadata.refs[0].id === "gh-pr-42");
      check("the ref mirrors the PR state", refOp.patch.metadata.refs[0].external_status === "merged");
      check(
        "the ref is scoped to the LINK's platform",
        refOp.patch.metadata.refs[0].platform === "ios",
        JSON.stringify(refOp.patch.metadata.refs[0]),
      );
      const promoteOp = ops[1];
      check(
        "the promotion targets that platform only",
        promoteOp.patch.metadata.platformStatuses.ios === "live" &&
          promoteOp.patch.metadata.platformStatuses.web === undefined,
        JSON.stringify(promoteOp.patch.metadata.platformStatuses),
      );
    }
    {
      // A repo serving every platform declares no platform on the link.
      const ops = pullRequest.planForProject(optedIn, {
        action: "closed", repoFullName: REPO, number: 42,
        url: "https://github.com/acme/ios-app/pull/42",
        title: "t", body: "AC-guest-checkout", merged: true, state: "closed",
      }, null);
      check("an unscoped link moves the base status", ops[1]?.patch.status === "live", JSON.stringify(ops[1]));
    }
    {
      // A link naming a platform the node does not have must not produce a
      // platformStatuses key validateBundle would reject.
      const webOnly = {
        project: { id: "gp", title: "T", metadata: { ref_policy: true } },
        nodes: [acceptance("AC-guest-checkout", ["web"])],
        edges: [],
      };
      const ops = pullRequest.planForProject(webOnly, {
        action: "closed", repoFullName: REPO, number: 42,
        url: "https://github.com/acme/ios-app/pull/42",
        title: "t", body: "AC-guest-checkout", merged: true, state: "closed",
      }, "ios");
      const ref = ops[0].patch.metadata.refs[0];
      check("a ref never claims a platform the node lacks", ref.platform === undefined, JSON.stringify(ref));
    }
    {
      const notOptedIn = {
        project: { id: "gp", title: "T" },
        nodes: [acceptance("AC-guest-checkout", ["web", "ios"])],
        edges: [],
      };
      const ops = pullRequest.planForProject(notOptedIn, {
        action: "closed", repoFullName: REPO, number: 42,
        url: "https://github.com/acme/ios-app/pull/42",
        title: "t", body: "AC-guest-checkout", merged: true, state: "closed",
      }, "ios");
      check(
        "without ref_policy the ref is mirrored but NOTHING is promoted",
        ops.length === 1 && ops[0].patch.metadata.refs,
        JSON.stringify(ops.map((o) => o.op)),
      );
    }
    {
      const unrelated = pullRequest.planForProject(optedIn, {
        action: "closed", repoFullName: REPO, number: 7,
        url: "https://github.com/acme/ios-app/pull/7",
        title: "chore: bump deps", body: "nothing here", merged: true, state: "closed",
      }, "ios");
      check("a PR mentioning no acceptance produces no ops", unrelated.length === 0);
    }

    // --- Repo links: the surface the webhook resolves against ----------------
    // Without a link, a delivery finds no projects and does nothing. These
    // assertions exist because the table and the webhook shipped before any way
    // to create a row, which made the whole feature unreachable.
    {
      const email = `ghtest-${Date.now()}@example.com`;
      const { rows } = await client.query(
        `insert into users (name, email) values ('ghtest', $1) returning id`,
        [email],
      );
      const userId = rows[0].id;
      const ownerId = (await api.owners.resolveOwnerIds(userId))[0];
      const created = await api.store.createProject({
        ownerId,
        tier: "klub",
        bundle: {
          schema_version: 2,
          project: {
            id: "gp",
            title: "Linked",
            metadata: { ref_policy: true },
            created_at: "2026-01-01T00:00:00.000Z",
            updated_at: "2026-01-01T00:00:00.000Z",
          },
          nodes: [acceptance("AC-guest-checkout", ["web", "ios"])],
          edges: [],
        },
      });
      check("the fixture project was created", created.ok === true, JSON.stringify(created));
      const projectId = created.id;
      const ctx = { params: Promise.resolve({ projectId }) };
      const origin = "https://arkaik.test";

      api.setSession({ user: { id: String(userId), name: "ghtest" } });

      const initial = await api.LIST_REPOS(new Request(origin), ctx);
      const initialBody = await initial.json();
      // Assert the response is what we think before reading into it — an
      // unauthenticated 401 here would otherwise surface as a TypeError far
      // from its cause.
      check("listing repos is authorized", initial.status === 200, `${initial.status} ${JSON.stringify(initialBody)}`);
      check("a fresh project has no repo links", initialBody.repos?.length === 0, JSON.stringify(initialBody));

      const linked = await api.LINK_REPO(
        new Request(origin, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ repo_full_name: "Acme/iOS-App", platform: "ios" }),
        }),
        ctx,
      );
      const linkedBody = await linked.json();
      check("linking a repo returns 201", linked.status === 201, `${linked.status} ${JSON.stringify(linkedBody)}`);
      check(
        "the name is lowercased on write (GitHub is case-insensitive)",
        linkedBody.repo?.repoFullName === "acme/ios-app",
        JSON.stringify(linkedBody),
      );

      check(
        "a malformed repo name is rejected",
        (
          await api.LINK_REPO(
            new Request(origin, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ repo_full_name: "not-a-repo" }),
            }),
            ctx,
          )
        ).status === 400,
      );
      check(
        "an invalid platform is rejected",
        (
          await api.LINK_REPO(
            new Request(origin, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ repo_full_name: "acme/x", platform: "windows" }),
            }),
            ctx,
          )
        ).status === 400,
      );

      // THE END-TO-END POINT: the webhook now finds the link.
      const found = await pullRequest.linkedProjects("acme/ios-app");
      check(
        "the webhook resolves a delivery to the linked project",
        found.some((l) => l.projectId === projectId && l.platform === "ios"),
        JSON.stringify(found),
      );
      check(
        "a delivery for a case-different name still resolves",
        (await pullRequest.linkedProjects("Acme/iOS-App")).some((l) => l.projectId === projectId),
      );

      // Owner scoping.
      const { rows: other } = await client.query(
        `insert into users (name, email) values ('ghtest2', $1) returning id`,
        [`ghtest2-${Date.now()}@example.com`],
      );
      await api.owners.resolveOwnerIds(other[0].id);
      api.setSession({ user: { id: String(other[0].id), name: "other" } });
      check(
        "another owner cannot list this project's repos",
        (await api.LIST_REPOS(new Request(origin), ctx)).status === 404,
      );
      check(
        "another owner cannot link a repo to it",
        (
          await api.LINK_REPO(
            new Request(origin, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ repo_full_name: "evil/repo" }),
            }),
            ctx,
          )
        ).status === 404,
      );

      api.setSession({ user: { id: String(userId), name: "ghtest" } });
      const unlinked = await api.UNLINK_REPO(new Request(`${origin}?repo=acme%2Fios-app`), ctx);
      check("unlinking returns 204", unlinked.status === 204, String(unlinked.status));
      check(
        "and the webhook no longer resolves it",
        (await pullRequest.linkedProjects("acme/ios-app")).every((l) => l.projectId !== projectId),
      );

      await client.query(`delete from graph_projects where id = $1`, [projectId]);
      await client.query(`delete from owner_members where user_id = any($1::int[])`, [[userId, other[0].id]]);
      await client.query(`delete from owners where id = any($1::text[])`, [[ownerId, `own-u${other[0].id}`]]);
      await client.query(`delete from users where id = any($1::int[])`, [[userId, other[0].id]]);
    }

    // --- The delivery ledger -------------------------------------------------
    const deliveryId = `test-delivery-${Date.now()}`;
    check("a fresh delivery is claimed", (await pullRequest.claimDelivery(deliveryId)) === true);
    check("the same delivery cannot be claimed twice", (await pullRequest.claimDelivery(deliveryId)) === false);
    await pullRequest.releaseDelivery(deliveryId);
    check(
      "a released delivery can be claimed again (so a retry after failure works)",
      (await pullRequest.claimDelivery(deliveryId)) === true,
    );
    await pullRequest.releaseDelivery(deliveryId);

    {
      // A redelivery of a handled event must not act twice.
      const shared = `dup-${Date.now()}`;
      const first = await POST(webhookReq(body, { delivery: shared }));
      const second = await POST(webhookReq(body, { delivery: shared }));
      check("the first delivery is processed", first.status === 200, String(first.status));
      check("a redelivery is reported as a duplicate", second.status === 202, String(second.status));
      check("and says so", (await second.json()).status === "duplicate");
      await pullRequest.releaseDelivery(shared);
    }
  } finally {
    await client.query(`delete from github_deliveries where delivery_id like 'delivery-%' or delivery_id like 'test-delivery-%' or delivery_id like 'dup-%'`).catch(() => {});
    await client.end();
    fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll github-webhook checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
