#!/usr/bin/env node

/**
 * The Lab-Note-into-journal half of a merged-PR delivery
 * (lib/services/github/lab-note.ts, wired in app/api/github/webhook).
 *
 * What must hold, and why it is asserted against a real Postgres:
 *   - a merged PR with a valid note lands EXACTLY ONE deliverable.shipped
 *     row per linked project, with the full note (fr included) on the event;
 *   - a redelivery of the same content appends NOTHING (content dedupe) —
 *     GitHub redeliveries and claim-release retries must not grow history;
 *   - an EDITED body redelivered appends a second occurrence with the same
 *     deliverable_id — the journal's own latest-wins correction path;
 *   - no note / invalid note / unmerged close append nothing, and an invalid
 *     note never fails the delivery (the acceptance half still runs);
 *   - the events survive the plane they'll be read from: the pollen feed.
 *
 * Same harness as github-webhook.test.js: nothing stubbed but NextAuth.
 */

const { Client } = require("pg");
const crypto = require("node:crypto");
const fs = require("fs");
const { loadGithubApi, BUILD_DIR } = require("./load-github-api");

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`PASS: ${name}`);
  else { failures++; console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`); }
}

const SECRET = "labnote-test-secret";
const REPO = "acme/notes-app";
/** A second repository on the same project, linked whole-repo but scoped to iOS. */
const IOS_REPO = "acme/notes-ios";

function sign(body, secret = SECRET) {
  return `sha256=${crypto.createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

// Unique per RUN, not just per process: the delivery ledger outlives this
// test's cleanup, so a reused id would be claimed already and answer 202.
const RUN = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
let deliveryCounter = 0;
function webhookReq(body, { delivery } = {}) {
  return new Request("https://arkaik.test/api/github/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": "pull_request",
      "x-github-delivery": delivery ?? `labnote-${RUN}-${++deliveryCounter}`,
      "x-hub-signature-256": sign(body),
    },
    body,
  });
}

const NOTE = [
  "Ships the thing.",
  "",
  "## Lab Note",
  "",
  "```yaml",
  "en:",
  '  title: "Find your way around"',
  '  summary: "A sidebar on wide screens."',
  "fr:",
  '  title: "Trouve ton chemin"',
  '  summary: "Une barre latérale sur grand écran."',
  "suggested:",
  "  molecule: pbbls",
  "  type: feature",
  "```",
].join("\n");

const INVALID_NOTE = ["## Lab Note", "", "```yaml", "en:", '  title: "Only a title"', "```"].join("\n");

function prPayload({ number = 7, body = NOTE, merged = true, action = "closed", repo = REPO, title = "Ship it" } = {}) {
  return JSON.stringify({
    action,
    repository: { full_name: repo },
    installation: { id: 9002 },
    pull_request: {
      number,
      html_url: `https://github.com/${repo}/pull/${number}`,
      title,
      body,
      merged,
      state: "closed",
    },
  });
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set — this integration test needs a migrated Postgres.");
    process.exit(1);
  }
  process.env.GITHUB_WEBHOOK_SECRET = SECRET;
  process.env.AUTH_SECRET ||= "ghtest-secret";
  process.env.AUTH_GITHUB_ID ||= "ghtest-id";
  process.env.AUTH_GITHUB_SECRET ||= "ghtest-secret";
  delete process.env.GITHUB_APP_ID;
  delete process.env.GITHUB_APP_PRIVATE_KEY;

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const api = loadGithubApi();
  const { POST } = api;

  const email = `ghtest-labnote-${Date.now()}@example.com`;
  let userId;

  const rowsFor = async (projectId, deliverableId) =>
    (
      await client.query(
        `select event, actor from graph_events
          where project_id = $1 and event->>'type' = 'deliverable.shipped' and event->>'deliverable_id' = $2
          order by seq asc`,
        [projectId, deliverableId],
      )
    ).rows;

  try {
    const { rows } = await client.query(
      `insert into users (name, email) values ('ghtest-labnote', $1) returning id`,
      [email],
    );
    userId = rows[0].id;
    const ownerId = (await api.owners.resolveOwnerIds(userId))[0];
    const created = await api.store.createProject({
      ownerId,
      tier: "klub",
      bundle: {
        schema_version: 3,
        project: {
          id: "gp-notes",
          title: "Notes",
          metadata: { pollen: { plant: "pbbls" } },
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
        nodes: [
          {
            id: "AC-find-your-way",
            project_id: "gp-notes",
            species: "acceptance",
            title: "Find your way around",
            status: "backlog",
            platforms: ["ios", "web"],
          },
          // A view and a data model: species a MENTION can never name, and so
          // the whole reason the note carries a `nodes:` key.
          {
            id: "V-sidebar",
            project_id: "gp-notes",
            species: "view",
            title: "Sidebar",
            status: "idea",
            platforms: ["ios", "web"],
          },
          {
            id: "DM-navigation",
            project_id: "gp-notes",
            species: "data-model",
            title: "Navigation",
            status: "idea",
            platforms: ["ios", "web"],
          },
        ],
        edges: [],
      },
    });
    check("fixture project created", created.ok === true, JSON.stringify(created));
    const projectId = created.id;

    api.setSession({ user: { id: String(userId), name: "ghtest-labnote" } });
    const linked = await api.LINK_REPO(
      new Request("https://arkaik.test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repo_full_name: REPO }),
      }),
      { params: Promise.resolve({ projectId }) },
    );
    check("repo linked", linked.status === 201, String(linked.status));
    const linkedIos = await api.LINK_REPO(
      new Request("https://arkaik.test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repo_full_name: IOS_REPO, platform: "ios" }),
      }),
      { params: Promise.resolve({ projectId }) },
    );
    check("iOS repo linked", linkedIos.status === 201, String(linkedIos.status));
    api.setSession(null);

    // --- merged PR with a valid note ---------------------------------------
    const first = await POST(webhookReq(prPayload()));
    const firstBody = await first.json();
    check("delivery succeeds", first.status === 200, `${first.status} ${JSON.stringify(firstBody)}`);
    check(
      "response reports the append",
      Array.isArray(firstBody.labNotes) && firstBody.labNotes.some((o) => o.status === "appended"),
      JSON.stringify(firstBody.labNotes),
    );
    let stored = await rowsFor(projectId, "pr-7");
    check("exactly one deliverable row", stored.length === 1, String(stored.length));
    check("actor is github-app", stored[0]?.actor === "github-app");
    check("title/summary from en", stored[0]?.event.title === "Find your way around" && stored[0]?.event.summary === "A sidebar on wide screens.");
    check("url is the PR", stored[0]?.event.url === `https://github.com/${REPO}/pull/7`);
    check("lab_note carries fr + suggested", stored[0]?.event.lab_note?.fr?.title === "Trouve ton chemin" && stored[0]?.event.lab_note?.suggested?.molecule === "pbbls");

    // --- identical redelivery: dedupe ---------------------------------------
    const redelivered = await POST(webhookReq(prPayload()));
    const redeliveredBody = await redelivered.json();
    check("redelivery succeeds", redelivered.status === 200);
    check(
      "redelivery reports unchanged",
      redeliveredBody.labNotes?.some((o) => o.status === "unchanged"),
      JSON.stringify(redeliveredBody.labNotes),
    );
    stored = await rowsFor(projectId, "pr-7");
    check("no second row on identical content", stored.length === 1, String(stored.length));

    // --- edited body: the correction path ------------------------------------
    const editedNote = NOTE.replace("A sidebar on wide screens.", "A sidebar, now with a map.");
    const edited = await POST(webhookReq(prPayload({ body: editedNote })));
    check("edited delivery succeeds", edited.status === 200);
    stored = await rowsFor(projectId, "pr-7");
    check("edited content appends a second occurrence", stored.length === 2, String(stored.length));
    check("latest occurrence carries the edit", stored[1]?.event.summary === "A sidebar, now with a map.");

    // --- no note -------------------------------------------------------------
    const noNote = await POST(webhookReq(prPayload({ number: 8, body: "chore: bump deps" })));
    const noNoteBody = await noNote.json();
    check("no-note delivery succeeds", noNote.status === 200);
    check("no-note reports no_note", noNoteBody.labNotes?.some((o) => o.status === "no_note"), JSON.stringify(noNoteBody.labNotes));
    check("no-note appends nothing", (await rowsFor(projectId, "pr-8")).length === 0);

    // --- invalid note: refused, logged, never fatal --------------------------
    const invalid = await POST(webhookReq(prPayload({ number: 9, body: INVALID_NOTE })));
    const invalidBody = await invalid.json();
    check("invalid-note delivery still succeeds", invalid.status === 200, String(invalid.status));
    check(
      "invalid note reported with the parse error",
      invalidBody.labNotes?.some((o) => o.status === "invalid" && o.error.includes("en.summary is required")),
      JSON.stringify(invalidBody.labNotes),
    );
    check("invalid note appends nothing", (await rowsFor(projectId, "pr-9")).length === 0);

    // --- unmerged close: not a lab-note event --------------------------------
    const closedUnmerged = await POST(webhookReq(prPayload({ number: 10, merged: false })));
    const closedBody = await closedUnmerged.json();
    check("unmerged close succeeds", closedUnmerged.status === 200);
    check("unmerged close runs no lab-note handling", (closedBody.labNotes ?? []).length === 0, JSON.stringify(closedBody.labNotes));
    check("unmerged close appends nothing", (await rowsFor(projectId, "pr-10")).length === 0);

    // --- the two fields the changelog card reads -----------------------------
    //
    // A deliverable is not just its note. The card lists the TOUCHED nodes and
    // chips their count from `node_ids`, and pills the release rhythm from
    // `platform` (components/journal/DeliverableHoverCard.tsx). The writer used
    // to build its payload from the note alone, so every deliverable the PR
    // routine ever wrote rendered as a title and a summary beside a replayed
    // history that rendered in full — while the SAME delivery had already read
    // the mentions and resolved the repository scope.
    const mentioning = `Implements AC-find-your-way\n\n${NOTE}`;
    const scoped = await POST(webhookReq(prPayload({ number: 11, body: mentioning })));
    check("a mentioning merge succeeds", scoped.status === 200, String(scoped.status));
    let stored11 = await rowsFor(projectId, "pr-11");
    check("the mentioning merge appends one deliverable", stored11.length === 1, String(stored11.length));
    check(
      "the deliverable records the acceptance the PR names",
      JSON.stringify(stored11[0]?.event.node_ids) === '["AC-find-your-way"]',
      JSON.stringify(stored11[0]?.event),
    );
    check(
      "an All-platforms link leaves the deliverable unscoped rather than claiming one",
      stored11[0]?.event.platform === undefined,
      JSON.stringify(stored11[0]?.event),
    );

    // An id the project does not hold is DROPPED: the card resolves ids against
    // the graph and skips what it cannot find, so a dangling id would inflate a
    // count of "nodes I can tell you about" by exactly the nodes it cannot.
    const withGhost = `Implements AC-find-your-way and AC-ghost\n\n${NOTE}`;
    const ghosted = await POST(webhookReq(prPayload({ number: 12, body: withGhost })));
    check("the ghost-mentioning merge succeeds", ghosted.status === 200, String(ghosted.status));
    const stored12 = await rowsFor(projectId, "pr-12");
    check(
      "an id no node answers to is dropped, not stored",
      JSON.stringify(stored12[0]?.event.node_ids) === '["AC-find-your-way"]',
      JSON.stringify(stored12[0]?.event),
    );

    // The platform half, from a repository link that names one. No changed-file
    // call is involved: the link is whole-repository, so the delivery answers
    // from the payload alone.
    const iosMerge = await POST(webhookReq(prPayload({ number: 13, repo: IOS_REPO })));
    check("the iOS-repo merge succeeds", iosMerge.status === 200, String(iosMerge.status));
    const stored13 = await rowsFor(projectId, "pr-13");
    check("the iOS-repo merge appends one deliverable", stored13.length === 1, String(stored13.length));
    check(
      "a platform-scoped repository link becomes the deliverable's platform",
      stored13[0]?.event.platform === "ios",
      JSON.stringify(stored13[0]?.event),
    );

    // --- the dedupe key has to cover the new fields --------------------------
    //
    // It compares title/summary/url/lab_note; a redelivery that resolves nodes
    // the stored event lacks is a REAL correction and must append, or the
    // enrichment can never reach a deliverable already written. The identical
    // redelivery beside it proves the key did not simply stop deduping.
    const redeliveredScoped = await POST(webhookReq(prPayload({ number: 11, body: mentioning })));
    check("the identical redelivery succeeds", redeliveredScoped.status === 200);
    stored11 = await rowsFor(projectId, "pr-11");
    check(
      "identical content still appends nothing, node_ids and all",
      stored11.length === 1,
      JSON.stringify(stored11.map((r) => r.event.node_ids)),
    );

    const unmentioning = await POST(webhookReq(prPayload({ number: 11, body: NOTE })));
    check("the mention-dropping redelivery succeeds", unmentioning.status === 200);
    stored11 = await rowsFor(projectId, "pr-11");
    check(
      "a delivery whose node_ids differ appends a correcting occurrence",
      stored11.length === 2,
      JSON.stringify(stored11.map((r) => r.event.node_ids)),
    );
    check(
      "…and the latest occurrence still carries the note, having simply stopped naming the node",
      stored11[1]?.event.title === "Find your way around" && stored11[1]?.event.node_ids === undefined,
      JSON.stringify(stored11[1]?.event),
    );

    // --- nodes: declared in the note ----------------------------------------
    //
    // A mention can only ever name an acceptance, so the deliverable a merge
    // writes could never list the views, flows, endpoints and models a replayed
    // history lists. The note's `nodes:` key is where the author says what the
    // change touched, and it is the half that makes a PR-born card read like a
    // replayed one.
    const declaring = NOTE.replace("suggested:", "nodes: [V-sidebar, DM-navigation]\nsuggested:");
    const declared = await POST(webhookReq(prPayload({ number: 14, body: declaring })));
    const declaredBody = await declared.json();
    check("a declaring merge succeeds", declared.status === 200, String(declared.status));
    const stored14 = await rowsFor(projectId, "pr-14");
    check("the declaring merge appends one deliverable", stored14.length === 1, String(stored14.length));
    check(
      "the deliverable records the nodes the note declared",
      JSON.stringify(stored14[0]?.event.node_ids) === '["V-sidebar","DM-navigation"]',
      JSON.stringify(stored14[0]?.event),
    );
    check(
      "the note itself still lands verbatim, nodes key included",
      JSON.stringify(stored14[0]?.event.lab_note?.nodes) === '["V-sidebar","DM-navigation"]',
      JSON.stringify(stored14[0]?.event.lab_note),
    );

    // Declared ids lead — the author's own order, and the richer half. A
    // mention can only append acceptances to the end of it.
    const both = `Implements AC-find-your-way\n\n${declaring}`;
    const mixed = await POST(webhookReq(prPayload({ number: 15, body: both })));
    check("the declaring-and-mentioning merge succeeds", mixed.status === 200, String(mixed.status));
    const stored15 = await rowsFor(projectId, "pr-15");
    check(
      "declared ids lead and the mentioned acceptance follows",
      JSON.stringify(stored15[0]?.event.node_ids) === '["V-sidebar","DM-navigation","AC-find-your-way"]',
      JSON.stringify(stored15[0]?.event),
    );

    // A dropped id is REPORTED. A silent drop is the failure nobody notices —
    // the author writes an id, the card renders without it, and nothing
    // anywhere says why.
    const withUnknown = NOTE.replace("suggested:", "nodes: [V-sidebar, V-ghost]\nsuggested:");
    const reported = await POST(webhookReq(prPayload({ number: 16, body: withUnknown })));
    const reportedBody = await reported.json();
    check("the unknown-node merge succeeds", reported.status === 200, String(reported.status));
    const stored16 = await rowsFor(projectId, "pr-16");
    check(
      "the id nothing answers to is left off the deliverable",
      JSON.stringify(stored16[0]?.event.node_ids) === '["V-sidebar"]',
      JSON.stringify(stored16[0]?.event),
    );
    const mine16 = (reportedBody.outcomes ?? []).filter((o) => o.projectId === projectId);
    check(
      "…and named in the delivery response, which is the only channel the author has",
      mine16.some((o) => (o.warnings ?? []).some((w) => w.includes("V-ghost"))),
      JSON.stringify(mine16),
    );
    check(
      "…without naming the ids that were fine",
      mine16.every((o) => (o.warnings ?? []).every((w) => !w.includes("V-sidebar"))),
      JSON.stringify(mine16),
    );
    check(
      "a clean declaration earns no warning at all",
      ((declaredBody.outcomes ?? []).find((o) => o.projectId === projectId)?.warnings ?? []).length === 0,
      JSON.stringify(declaredBody.outcomes),
    );
  } finally {
    if (userId !== undefined) {
      const ownerIds = [`own-u${userId}`];
      await client.query(`delete from project_repos where project_id in (select id from graph_projects where owner_id = any($1::text[]))`, [ownerIds]);
      await client.query(`delete from graph_projects where owner_id = any($1::text[])`, [ownerIds]);
      await client.query(`delete from owner_members where user_id = $1`, [userId]);
      await client.query(`delete from owners where id = any($1::text[])`, [ownerIds]);
      await client.query(`delete from users where id = $1`, [userId]);
    }
    await client.end();
    fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  }

  if (failures > 0) {
    console.log(`\n${failures} lab-note webhook test(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll lab-note webhook tests passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
