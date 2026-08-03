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
 * Plus the halves of the planner that only mean anything with a database
 * behind them: that a delivery resolves to a linked project at all, and the
 * delivery ledger that makes a retry safe.
 *
 * The PURE planner — the mention grammar, per-platform ref ids, precedence,
 * promotion folding — lives in pr-plan.test.js, which needs no Postgres and so
 * runs in CI's `build` job and on a laptop. Only a thin wiring check is kept
 * here: enough to catch the two halves disagreeing, not a second copy that
 * would drift.
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
    repository: { full_name: overrides.repo ?? REPO },
    // Every GitHub App delivery carries this; it is what lets arkaik call the
    // API back for path-scoped links, and what `recordInstallation` stores.
    installation: { id: 9001 },
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
    status: "backlog",
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
  // THE GITHUB APP IS DELIBERATELY UNCONFIGURED, and this is an assertion about
  // this suite's reach, not tidiness. The monorepo block below drives a real
  // delivery into a repository linked BY PATH, and `needsChangedFiles` returns
  // true for any mentioning delivery there — explicit `@platform` included — so
  // `applyPullRequestEvent` really does call `githubApp().listPullRequestFiles`.
  // `appReadiness` is the first thing that runs inside it and returns a value
  // (never a throw, never a request) when these are absent, so deleting them
  // makes "this suite never reaches api.github.com" a PROPERTY of the run
  // rather than an accident of whatever CI happens to have exported.
  delete process.env.GITHUB_APP_ID;
  delete process.env.GITHUB_APP_PRIVATE_KEY;

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

    // --- Planning: the wiring, not the grammar -------------------------------
    // Deliberately thin. pr-plan.test.js owns the behaviour; what is worth
    // asserting HERE is that the module the route imports is the one that
    // behaves that way — a stale build or a bad rewrite in the loader would
    // show up as these three failing while the pure suite stays green.
    const optedIn = {
      project: { id: "gp", title: "T", metadata: { ref_policy: true } },
      nodes: [acceptance("AC-guest-checkout", ["web", "ios"])],
      edges: [],
    };
    const prEvent = (overrides = {}) => ({
      action: "closed",
      repoFullName: REPO,
      number: 42,
      url: "https://github.com/acme/ios-app/pull/42",
      title: "Guest checkout",
      body: "Implements AC-guest-checkout",
      merged: true,
      state: "closed",
      ...overrides,
    });
    /** The node as applyOps would leave it: `{ ...current, ...patch }`, in order. */
    const settle = (node, ops) =>
      ops.reduce((acc, op) => (op.node_id === node.id ? { ...acc, ...op.patch } : acc), node);
    const prRef = (state, platform) =>
      (state.metadata?.refs ?? []).find(
        (r) => r.url === "https://github.com/acme/ios-app/pull/42" && (r.platform ?? null) === platform,
      );
    // planForProject returns `{ ops, warnings }`; these blocks are about the ops.
    const planOps = (...args) => pullRequest.planForProject(...args).ops;
    /** The scope a single whole-repository link resolves to, through the real resolver. */
    const wholeRepo = (platform = null) =>
      pullRequest.resolveRepoScope([{ platform, pathPrefix: "" }], { kind: "not-needed" });
    {
      const ops = planOps(optedIn, prEvent(), wholeRepo("ios"));
      const state = settle(optedIn.nodes[0], ops);
      const ref = prRef(state, "ios");
      check("a bare mention takes the LINK's platform", ref !== undefined, JSON.stringify(state.metadata));
      check("with the per-platform ref id", ref?.id === "gh-pr-42-ios", JSON.stringify(ref));
      check("mirroring the PR state", ref?.external_status === "merged", JSON.stringify(ref));
      check(
        "and promoting that platform only",
        state.metadata?.platformStatuses?.ios === "live" &&
          state.metadata?.platformStatuses?.web === undefined,
        JSON.stringify(state.metadata?.platformStatuses),
      );
    }
    {
      // The headline case: one PR, two platforms, one acceptance.
      const ops = planOps(
        optedIn,
        prEvent({ body: "Implements AC-guest-checkout@ios and AC-guest-checkout@web" }),
        wholeRepo("ios"),
      );
      const state = settle(optedIn.nodes[0], ops);
      check("an explicit mention mints a ref per platform: ios", prRef(state, "ios") !== undefined, JSON.stringify(state.metadata));
      check("…and web", prRef(state, "web") !== undefined, JSON.stringify(state.metadata));
      check(
        "and BOTH promotions survive the batch",
        state.metadata?.platformStatuses?.ios === "live" && state.metadata?.platformStatuses?.web === "live",
        JSON.stringify(state.metadata?.platformStatuses),
      );
    }
    {
      const unrelated = planOps(
        optedIn,
        prEvent({ number: 7, url: "https://github.com/acme/ios-app/pull/7", title: "chore", body: "nothing here" }),
        wholeRepo("ios"),
      );
      check("the planner returns an op list", Array.isArray(unrelated), JSON.stringify(unrelated));
      check(
        "a PR mentioning no acceptance touches nothing",
        unrelated.find((o) => o.node_id === "AC-guest-checkout") === undefined,
        JSON.stringify(unrelated),
      );
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
          schema_version: 3,
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

      // --- The report channel, end to end ------------------------------------
      // `ApplyOutcome.warnings` is the only way a user learns that a delivery
      // understood the PR and deliberately did nothing. It only means anything
      // if it survives all the way into the HTTP body, which is what Recent
      // Deliveries renders — so this asserts on the RESPONSE, not on the
      // planner. It has to run while the link above is still live: after the
      // unlink below, the delivery resolves to no project and carries no
      // outcome to hang a warning on.
      {
        const unknownBody = prPayload({
          pull_request: { body: "Implements AC-guest-checkout@windows" },
        });
        const res = await POST(webhookReq(unknownBody));
        const json = await res.json();
        // Assert the delivery was accepted before reading into it: a 401 or a
        // duplicate 202 would otherwise make every assertion below pass by
        // finding nothing.
        check("a delivery naming an unknown platform is accepted", res.status === 200, `${res.status} ${JSON.stringify(json)}`);
        const outcome = (json.outcomes ?? []).find((o) => o.projectId === projectId);
        check("and produces an outcome for the linked project", outcome !== undefined, JSON.stringify(json));
        check(
          "which reports the unusable suffix in the response body",
          (outcome?.warnings ?? []).some((w) => w.includes("AC-guest-checkout") && w.includes("windows")),
          JSON.stringify(outcome),
        );
        check(
          "and applies nothing",
          outcome?.applied === 0 && outcome?.skipped === "no usable acceptance mention",
          JSON.stringify(outcome),
        );
        // The refusal is a property of the ID, not of a usable mention sitting
        // beside the typo: `@windows` is the ONLY thing this body says about
        // AC-guest-checkout, and the planner still refuses it explicitly rather
        // than letting the node fall through to the repository link (which
        // declares `ios` here) as an unnamed acceptance would.
        check(
          "an id named ONLY by an unusable suffix earns the planner's refusal too",
          (outcome?.warnings ?? []).some((w) => w.includes("was not understood")),
          JSON.stringify(outcome),
        );
      }
      {
        // The other half: an explicit platform the acceptance does not list.
        // The ref DOES attach, so `applied` is non-zero — without the warning
        // the response reads as a plain success and the author concludes
        // Android shipped. AC-guest-checkout is ["web", "ios"].
        const inapplicableBody = prPayload({
          pull_request: { body: "Implements AC-guest-checkout@android" },
        });
        const res = await POST(webhookReq(inapplicableBody));
        const json = await res.json();
        check("a delivery naming an inapplicable platform is accepted", res.status === 200, `${res.status} ${JSON.stringify(json)}`);
        const outcome = (json.outcomes ?? []).find((o) => o.projectId === projectId);
        check("and produces an outcome for the linked project", outcome !== undefined, JSON.stringify(json));
        check(
          "the mutation went through",
          outcome?.applied > 0 && outcome?.skipped === undefined,
          JSON.stringify(outcome),
        );
        check(
          "and the refusal to promote reaches the response body",
          (outcome?.warnings ?? []).some((w) => w.includes("AC-guest-checkout") && w.includes("android")),
          JSON.stringify(outcome),
        );
        // The point of the warning: the status did NOT move.
        const after = await api.store.getProject(projectId, [ownerId]);
        const node = after?.bundle.nodes.find((n) => n.id === "AC-guest-checkout");
        check("the acceptance is still readable", node !== undefined, JSON.stringify(after?.bundle?.nodes));
        check(
          "and android was never marked shipped",
          node?.metadata?.platformStatuses?.android === undefined,
          JSON.stringify(node?.metadata),
        );
        check(
          "though the ref is attached, carrying the platform the author asked for",
          (node?.metadata?.refs ?? []).some((r) => r.platform === "android"),
          JSON.stringify(node?.metadata?.refs),
        );
      }

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

    // --- A MONOREPO: several path-scoped links, ONE project ------------------
    // The delivery loop used to run per LINK, which was indistinguishable from
    // per project while a project could link a repository only once. With two
    // links it would be two loads, two mutations, two version bumps and two
    // outcomes for one pull request — and the two could write conflicting ref
    // scopes in an order nothing pins down.
    {
      const email = `ghmono-${Date.now()}@example.com`;
      const { rows } = await client.query(
        `insert into users (name, email) values ('ghmono', $1) returning id`,
        [email],
      );
      const userId = rows[0].id;
      const ownerId = (await api.owners.resolveOwnerIds(userId))[0];
      const created = await api.store.createProject({
        ownerId,
        tier: "klub",
        bundle: {
          schema_version: 3,
          project: {
            id: "gp",
            title: "Monorepo",
            metadata: { ref_policy: true },
            created_at: "2026-01-01T00:00:00.000Z",
            updated_at: "2026-01-01T00:00:00.000Z",
          },
          nodes: [acceptance("AC-checkout", ["web", "ios"]), acceptance("AC-search", ["web", "ios"])],
          edges: [],
        },
      });
      check("the monorepo fixture project was created", created.ok === true, JSON.stringify(created));
      const projectId = created.id;
      const ctx = { params: Promise.resolve({ projectId }) };
      const origin = "https://arkaik.test";
      api.setSession({ user: { id: String(userId), name: "ghmono" } });

      const link = async (path, platform) =>
        api.LINK_REPO(
          new Request(origin, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ repo_full_name: "acme/monorepo", platform, path }),
          }),
          ctx,
        );

      const first = await link("apps/ios", "ios");
      const firstBody = await first.json();
      check("a path-scoped link is created", first.status === 201, `${first.status} ${JSON.stringify(firstBody)}`);
      check("carrying its normalised prefix", firstBody.repo?.pathPrefix === "apps/ios", JSON.stringify(firstBody));

      // THE ON CONFLICT TARGET: without the four-column key this second insert
      // either overwrites the first or fails outright.
      const second = await link("apps/webapp/", "web");
      const secondBody = await second.json();
      check(
        "a SECOND link to the same repository at another path is created, not an overwrite",
        second.status === 201 && secondBody.repo?.pathPrefix === "apps/webapp",
        `${second.status} ${JSON.stringify(secondBody)}`,
      );
      const listed = await (await api.LIST_REPOS(new Request(origin), ctx)).json();
      check(
        "and both survive in the listing, distinguished by path",
        JSON.stringify((listed.repos ?? []).map((r) => [r.repoFullName, r.pathPrefix, r.platform])) ===
          JSON.stringify([
            ["acme/monorepo", "apps/ios", "ios"],
            ["acme/monorepo", "apps/webapp", "web"],
          ]),
        JSON.stringify(listed),
      );
      check(
        "a path with a .. segment is refused with 400, not stored",
        (await link("apps/../etc", "ios")).status === 400,
      );

      const before = await api.store.getProject(projectId, [ownerId]);
      check("precondition: the project is readable before the delivery", before !== null, JSON.stringify(before));

      // THIS DELIVERY DOES CALL FOR THE CHANGED FILES, and used not to.
      //
      // The comment that stood here said the opposite: an explicit `@platform`
      // decides the scope on its own, so the delivery "needs no changed-files
      // call". That stopped being true when the path matches became one of the
      // sources that keep a ref moving — `needsChangedFiles` now returns true
      // for ANY mentioning delivery in a path-scoped repository. The block kept
      // passing only because GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY happened
      // to be unset in CI, which is an accident rather than a test.
      //
      // They are now DELETED at the top of `main`, so `appReadiness` fails
      // deterministically, `listPullRequestFiles` returns `{ ok: false }`
      // without issuing a request, and the repo scope resolves to the
      // `unavailable` refusal. What that leaves this block verifying is:
      //
      //   - GROUPING: two links to one repository are one project, so one
      //     load, one mutation, one version bump and one outcome;
      //   - PRECEDENCE: an explicit `@platform` decides even when the changed
      //     files could not be read at all, because nothing had to be inferred;
      //   - CONTAINMENT: an unreadable file list narrows nothing and claims
      //     nothing extra — each acceptance moves its own platform and no base
      //     status moves.
      const res = await POST(
        webhookReq(
          prPayload({
            repo: "acme/monorepo",
            pull_request: {
              number: 77,
              html_url: "https://github.com/acme/monorepo/pull/77",
              body: "Implements AC-checkout@ios and AC-search@web",
            },
          }),
        ),
      );
      const json = await res.json();
      check("the monorepo delivery is accepted", res.status === 200, `${res.status} ${JSON.stringify(json)}`);
      const mine = (json.outcomes ?? []).filter((o) => o.projectId === projectId);
      check(
        "TWO links to one repository produce exactly ONE outcome for the project",
        mine.length === 1,
        JSON.stringify(json.outcomes),
      );
      check("…which applied something", mine[0]?.applied > 0, JSON.stringify(mine[0]));
      // An explicit `@platform` outranks the path source, so an unreadable file
      // list costs this delivery nothing at all — not a refusal, not a warning.
      // (`assembleOutcome` omits the key entirely when there is nothing to
      // report, so this is `undefined` and not `[]`.)
      check(
        "an unreadable file list warns about nothing when every mention names its own platform",
        mine[0]?.warnings === undefined,
        JSON.stringify(mine[0]),
      );

      const after = await api.store.getProject(projectId, [ownerId]);
      check(
        "and ONE version increment, not one per link",
        Number(after?.version) === Number(before?.version) + 1,
        `${before?.version} -> ${after?.version}`,
      );
      const checkout = after?.bundle.nodes.find((n) => n.id === "AC-checkout");
      const search = after?.bundle.nodes.find((n) => n.id === "AC-search");
      check("both acceptances are still readable", checkout !== undefined && search !== undefined, JSON.stringify(after?.bundle?.nodes));
      check(
        "both scoped promotions survived the single batch",
        checkout?.metadata?.platformStatuses?.ios === "live" &&
          search?.metadata?.platformStatuses?.web === "live",
        JSON.stringify([checkout?.metadata, search?.metadata]),
      );
      check(
        "and neither base status moved",
        checkout?.status === "backlog" && search?.status === "backlog",
        JSON.stringify([checkout?.status, search?.status]),
      );

      // The installation id the payload carried is now stored, which is what a
      // later delivery without one falls back to.
      const { rows: stored } = await client.query(
        `select distinct installation_id from project_repos where project_id = $1`,
        [projectId],
      );
      check(
        "the delivery's installation id was persisted onto the links",
        JSON.stringify(stored.map((r) => r.installation_id)) === '["9001"]',
        JSON.stringify(stored),
      );

      // DELETE takes the path, and an absent one means the whole-repository
      // link — which does not exist here, so it must NOT delete either row.
      const wrong = await api.UNLINK_REPO(new Request(`${origin}?repo=acme%2Fmonorepo`), ctx);
      const wrongBody = await wrong.json();
      check("unlinking with no path does not delete a path-scoped link", wrong.status === 404, String(wrong.status));
      check(
        "…and the 404 names the prefixes that DO exist",
        String(wrongBody.message ?? "").includes("apps/ios"),
        JSON.stringify(wrongBody),
      );
      const still = await pullRequest.linkedProjects("acme/monorepo");
      check(
        "both links are still there after the refused delete",
        still.filter((l) => l.projectId === projectId).length === 2,
        JSON.stringify(still),
      );

      const gone = await api.UNLINK_REPO(new Request(`${origin}?repo=acme%2Fmonorepo&path=apps%2Fios`), ctx);
      check("unlinking WITH the path returns 204", gone.status === 204, String(gone.status));
      const remaining = (await pullRequest.linkedProjects("acme/monorepo")).filter(
        (l) => l.projectId === projectId,
      );
      check(
        "and removes exactly that one link, leaving its sibling alone",
        JSON.stringify(remaining.map((l) => l.pathPrefix)) === '["apps/webapp"]',
        JSON.stringify(remaining),
      );

      await client.query(`delete from graph_projects where id = $1`, [projectId]);
      await client.query(`delete from owner_members where user_id = $1`, [userId]);
      await client.query(`delete from owners where id = $1`, [ownerId]);
      await client.query(`delete from users where id = $1`, [userId]);
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
