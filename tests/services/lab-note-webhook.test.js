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

function prPayload({ number = 7, body = NOTE, merged = true, action = "closed" } = {}) {
  return JSON.stringify({
    action,
    repository: { full_name: REPO },
    installation: { id: 9002 },
    pull_request: {
      number,
      html_url: `https://github.com/${REPO}/pull/${number}`,
      title: "Ship it",
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
        nodes: [],
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
