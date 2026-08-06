#!/usr/bin/env node

/**
 * Integration tests for the hosted graph API (db/migrations/008_graph_projects.sql,
 * lib/services/graph/store.ts, app/api/graph/**).
 *
 * Run against a real Postgres whose schema was applied by `npm run db:migrate`.
 * Only NextAuth is stubbed; the store, token verification, owner resolution,
 * scope enforcement, and the `select … for update` transactions all run for real.
 *
 * The properties that matter most here, and why:
 *   - a REFUSED mutation writes nothing — not the snapshot, not the version, not
 *     a single event. This is the whole promise of the validator gate, and it is
 *     the one thing a partial implementation would still appear to pass.
 *   - owner scoping: another owner's project is 404, never 403, so ids cannot be
 *     probed.
 *   - batch atomicity: node + edge land together or not at all.
 *   - scopes are enforced, so a read-only agent token cannot write.
 *
 * Test rows use the `graphtest-%@example.com` email pattern and are cleaned up
 * by derived owner id at start and end, so local re-runs are idempotent.
 */

const { Client } = require("pg");
const fs = require("fs");
const { loadGraphApi, BUILD_DIR } = require("./load-graph-api");

const ORIGIN = "https://graph.test";

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS: ${name}`);
  } else {
    failures++;
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const ctx = (projectId) => ({ params: Promise.resolve({ projectId }) });
const sessionFor = (userId) => ({ user: { id: String(userId), name: "graphtest" } });

function node(id, species, extra = {}) {
  return {
    id,
    project_id: "gp",
    species,
    title: id,
    status: "idea",
    platforms: ["web"],
    ...extra,
  };
}

function bundle(nodes = [], edges = []) {
  return {
    schema_version: 3,
    project: {
      id: "gp",
      title: "Graph test",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    },
    nodes,
    edges,
  };
}

function jsonReq(url, method, body, headers = {}) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const bearer = (token) => ({ authorization: `Bearer ${token}` });

async function seedUser(client, label) {
  const email = `graphtest-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const { rows } = await client.query(
    `insert into users (name, email) values ($1, $2) returning id`,
    [`graphtest ${label}`, email],
  );
  return rows[0].id;
}

async function cleanup(client) {
  const { rows } = await client.query(
    `select id from users where email like 'graphtest-%@example.com'`,
  );
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return;
  const ownerIds = ids.map((id) => `own-u${id}`);
  // graph_events cascades from graph_projects, which cascades from owners.
  await client.query(`delete from graph_projects where owner_id = any($1::text[])`, [ownerIds]);
  await client.query(`delete from api_tokens where user_id = any($1::int[])`, [ids]);
  await client.query(`delete from owner_members where user_id = any($1::int[])`, [ids]);
  await client.query(`delete from owners where id = any($1::text[])`, [ownerIds]);
  await client.query(`delete from users where id = any($1::int[])`, [ids]);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set — this integration test needs a migrated Postgres.");
    process.exit(1);
  }
  process.env.AUTH_SECRET ||= "graphtest-secret";
  process.env.AUTH_GITHUB_ID ||= "graphtest-id";
  process.env.AUTH_GITHUB_SECRET ||= "graphtest-secret";

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await cleanup(client);

  const api = loadGraphApi();
  const { store, tokens, owners, setSession } = api;

  try {
    const userA = await seedUser(client, "a");
    const userB = await seedUser(client, "b");
    const ownerA = (await owners.resolveOwnerIds(userA))[0];
    await owners.resolveOwnerIds(userB);

    // --- Auth + scope gates -------------------------------------------------
    setSession(null);
    check(
      "unauthenticated list returns 401",
      (await api.LIST_PROJECTS(new Request(`${ORIGIN}/api/graph/projects`))).status === 401,
    );

    const readOnly = await tokens.mintToken({
      ownerId: ownerA,
      userId: userA,
      name: "read-only",
      scopes: ["graph:read"],
    });
    const writeToken = await tokens.mintToken({
      ownerId: ownerA,
      userId: userA,
      name: "agent",
      scopes: ["graph:read", "graph:write"],
    });

    // --- Create -------------------------------------------------------------
    setSession(sessionFor(userA));
    const created = await api.CREATE_PROJECT(
      jsonReq(`${ORIGIN}/api/graph/projects`, "POST", bundle([node("V-a", "view")])),
    );
    const createdBody = await created.json();
    check("POST /projects returns 201", created.status === 201, String(created.status));
    check("the created id is server-owned (prj_)", createdBody.id?.startsWith("prj_"), createdBody.id);
    const projectId = createdBody.id;

    const badCreate = await api.CREATE_PROJECT(
      jsonReq(`${ORIGIN}/api/graph/projects`, "POST", bundle([], [
        { id: "e-x-y", project_id: "gp", source_id: "V-nope", target_id: "V-alsonope", edge_type: "composes" },
      ])),
    );
    check("a dangling-edge bundle is refused with 422", badCreate.status === 422, String(badCreate.status));
    check("the 422 carries pathed findings", Array.isArray((await badCreate.json()).errors));

    // --- Imported history is per-project, not global -------------------------
    // REGRESSION: event ULIDs travel inside an exported bundle, so two owners
    // importing the SAME bundle legitimately hold identical event ids. With a
    // global `primary key (id)` on graph_events the second import collided and
    // silently dropped its entire journal. seed/pebbles.json ships with a
    // journal, so this is the ordinary path, not a corner case.
    const shared = bundle([node("V-a", "view")]);
    // Payload fields sit FLAT on the envelope (docs/spec/journal.md § Event
    // Envelope) — `{ type, payload: {...} }` is `EventInput`, the pre-stamp
    // shape used inside derive.ts, and is NOT what a stored event looks like.
    shared.journal = [
      {
        id: "01KN44ARM0JH4YFMX52BGKNPKZ",
        ts: "2026-01-01T00:00:00.000Z",
        actor: "seed",
        type: "node.created",
        node_id: "V-a",
        species: "view",
        title: "A",
      },
    ];

    const firstImport = await api.CREATE_PROJECT(jsonReq(`${ORIGIN}/api/graph/projects`, "POST", shared));
    const firstBody = await firstImport.json();
    // Print the findings on failure — a bare status code sent me guessing at the
    // event shape rather than reading what the validator actually objected to.
    check(
      "a journal-carrying bundle imports",
      firstImport.status === 201,
      `${firstImport.status} ${JSON.stringify(firstBody.errors ?? firstBody)}`,
    );
    const firstId = firstBody.id;

    setSession(sessionFor(userB));
    const secondImport = await api.CREATE_PROJECT(jsonReq(`${ORIGIN}/api/graph/projects`, "POST", shared));
    const secondBody = await secondImport.json();
    check(
      "another owner can import the same bundle",
      secondImport.status === 201,
      `${secondImport.status} ${JSON.stringify(secondBody.errors ?? secondBody)}`,
    );
    const secondId = secondBody.id;

    const secondJournal = await (await api.GET_JOURNAL(new Request(ORIGIN), ctx(secondId))).json();
    check(
      "the second import KEEPS its journal (not swallowed by a global id clash)",
      secondJournal.journal.length === 1,
      `got ${secondJournal.journal.length} events`,
    );
    setSession(sessionFor(userA));
    const firstJournal = await (await api.GET_JOURNAL(new Request(ORIGIN), ctx(firstId))).json();
    check("the first import still has its journal", firstJournal.journal.length === 1);

    // --- Owner scoping ------------------------------------------------------
    setSession(sessionFor(userB));
    const otherList = await api.LIST_PROJECTS(new Request(`${ORIGIN}/api/graph/projects`));
    const otherIds = (await otherList.json()).projects.map((p) => p.id);
    check(
      "another owner's listing never contains this project",
      !otherIds.includes(projectId),
      otherIds.join(","),
    );
    const otherGet = await api.GET_PROJECT(new Request(ORIGIN), ctx(projectId));
    check("another owner gets 404, not 403", otherGet.status === 404, String(otherGet.status));
    const otherMutate = await api.MUTATE(
      jsonReq(ORIGIN, "POST", { ops: [{ op: "create_node", node: node("V-evil", "view") }] }),
      ctx(projectId),
    );
    check("another owner cannot mutate (404)", otherMutate.status === 404, String(otherMutate.status));

    // --- Read ---------------------------------------------------------------
    setSession(sessionFor(userA));
    const got = await api.GET_PROJECT(new Request(ORIGIN), ctx(projectId));
    const gotBody = await got.json();
    check("GET project returns the bundle", got.status === 200 && gotBody.bundle.nodes.length === 1);
    check("GET project sets an ETag from the version", got.headers.get("etag") === `"${gotBody.version}"`);
    check("initial version is 1", gotBody.version === "1", gotBody.version);

    // --- Scope enforcement --------------------------------------------------
    setSession(null);
    const readOnlyWrite = await api.MUTATE(
      jsonReq(ORIGIN, "POST", { ops: [{ op: "create_node", node: node("V-b", "view") }] }, bearer(readOnly.plaintext)),
      ctx(projectId),
    );
    check(
      "a graph:read token cannot write (403 insufficient_scope)",
      readOnlyWrite.status === 403,
      String(readOnlyWrite.status),
    );
    const readOnlyRead = await api.GET_NODES(
      new Request(ORIGIN, { headers: bearer(readOnly.plaintext) }),
      ctx(projectId),
    );
    check("a graph:read token can read", readOnlyRead.status === 200);

    // --- Mutate via an agent token -----------------------------------------
    const mutated = await api.MUTATE(
      jsonReq(ORIGIN, "POST", { ops: [{ op: "create_node", node: node("V-b", "view") }] }, bearer(writeToken.plaintext)),
      ctx(projectId),
    );
    const mutatedBody = await mutated.json();
    check("an agent token can mutate", mutated.status === 200, String(mutated.status));
    check("the mutation returns the new graph", mutatedBody.nodes.length === 2);
    check("the version bumped to 2", mutatedBody.version === "2", mutatedBody.version);
    check("the response ETag matches the new version", mutated.headers.get("etag") === '"2"');
    check(
      "an agent's write is attributed to arkaik-agent",
      mutatedBody.events[0]?.actor === "arkaik-agent",
      mutatedBody.events[0]?.actor,
    );

    // --- Batch atomicity ----------------------------------------------------
    const batch = await api.MUTATE(
      jsonReq(
        ORIGIN,
        "POST",
        {
          ops: [
            { op: "create_node", node: node("AC-x", "acceptance") },
            {
              op: "create_edge",
              edge: { id: "", project_id: "gp", source_id: "AC-x", target_id: "V-a", edge_type: "covers" },
            },
          ],
        },
        bearer(writeToken.plaintext),
      ),
      ctx(projectId),
    );
    const batchBody = await batch.json();
    check("a node+edge batch applies", batch.status === 200, String(batch.status));
    check("both landed together", batchBody.nodes.length === 3 && batchBody.edges.length === 1);
    check("the batch emitted two events", batchBody.events.length === 2);

    // --- A refused mutation writes NOTHING ---------------------------------
    // These reads MUST carry a credential: the session is null in this section,
    // so an unauthenticated GET would 401 and every field below would be
    // undefined — making the comparisons pass vacuously rather than prove
    // anything. Asserting the bundle is actually present guards that directly.
    const readReq = () => new Request(ORIGIN, { headers: bearer(readOnly.plaintext) });
    const beforeRefusal = await (await api.GET_PROJECT(readReq(), ctx(projectId))).json();
    check("the pre-refusal read actually returned a bundle", Boolean(beforeRefusal.bundle));
    const refused = await api.MUTATE(
      jsonReq(
        ORIGIN,
        "POST",
        {
          ops: [
            { op: "create_node", node: node("V-ghost", "view") },
            {
              op: "create_edge",
              edge: { id: "", project_id: "gp", source_id: "V-ghost", target_id: "V-missing", edge_type: "composes" },
            },
          ],
        },
        bearer(writeToken.plaintext),
      ),
      ctx(projectId),
    );
    check("a dangling edge is refused with 422", refused.status === 422, String(refused.status));
    const afterRefusal = await (await api.GET_PROJECT(readReq(), ctx(projectId))).json();
    check("the post-refusal read actually returned a bundle", Boolean(afterRefusal.bundle));
    check(
      "the refused batch left the version alone",
      Boolean(afterRefusal.version) && afterRefusal.version === beforeRefusal.version,
      `${beforeRefusal.version} → ${afterRefusal.version}`,
    );
    check(
      "the refused batch left the snapshot alone",
      afterRefusal.bundle.nodes.length === beforeRefusal.bundle.nodes.length,
    );
    check(
      "the refused batch wrote no ghost node",
      !afterRefusal.bundle.nodes.some((n) => n.id === "V-ghost"),
    );

    const refusedOp = await api.MUTATE(
      jsonReq(ORIGIN, "POST", { ops: [{ op: "update_node", node_id: "V-nope", patch: { status: "live" } }] }, bearer(writeToken.plaintext)),
      ctx(projectId),
    );
    const refusedOpBody = await refusedOp.json();
    check("an unknown node is refused with 422", refusedOp.status === 422);
    check(
      "the refusal carries the machine-readable code",
      refusedOpBody.code === "node_not_found",
      JSON.stringify(refusedOpBody),
    );

    // --- Optimistic concurrency --------------------------------------------
    const current = await (await api.GET_PROJECT(readReq(), ctx(projectId))).json();
    check("the concurrency baseline read returned a version", Boolean(current.version));
    const stale = await api.MUTATE(
      jsonReq(
        ORIGIN,
        "POST",
        { ops: [{ op: "create_node", node: node("V-stale", "view") }] },
        { ...bearer(writeToken.plaintext), "if-match": '"1"' },
      ),
      ctx(projectId),
    );
    check("a stale If-Match returns 409", stale.status === 409, String(stale.status));
    const staleBody = await stale.json();
    // Guarded like the refusal checks above: two undefineds comparing equal
    // would report success while proving nothing.
    check(
      "the 409 reports the current version",
      Boolean(staleBody.version) && staleBody.version === current.version,
      `${staleBody.version} vs ${current.version}`,
    );

    const fresh = await api.MUTATE(
      jsonReq(
        ORIGIN,
        "POST",
        { ops: [{ op: "create_node", node: node("V-fresh", "view") }] },
        { ...bearer(writeToken.plaintext), "if-match": `"${current.version}"` },
      ),
      ctx(projectId),
    );
    check("a matching If-Match applies", fresh.status === 200, String(fresh.status));

    // --- Journal + export ---------------------------------------------------
    const journal = await (await api.GET_JOURNAL(new Request(ORIGIN, { headers: bearer(readOnly.plaintext) }), ctx(projectId))).json();
    // By identity, not count. A count couples this to how many mutations earlier
    // assertions happen to make — which has now broken three assertions across
    // this program, every time for a reason that said nothing about the code.
    const journalled = journal.journal.map((e) => `${e.type}:${e.node_id ?? e.edge_id ?? ""}`);
    check(
      "every accepted mutation reached the journal",
      ["node.created:V-b", "node.created:AC-x", "node.created:V-fresh"].every((k) => journalled.includes(k)),
      journalled.join(" | "),
    );
    check(
      "the batch's edge was journalled alongside its node",
      journalled.some((entry) => entry.startsWith("edge.added:")),
      journalled.join(" | "),
    );
    check(
      "no event from a refused mutation is present",
      !journal.journal.some((e) => JSON.stringify(e).includes("V-ghost")),
    );
    const exported = await (await api.EXPORT(new Request(ORIGIN, { headers: bearer(readOnly.plaintext) }), ctx(projectId))).json();
    check("export embeds the journal", Array.isArray(exported.bundle.journal) && exported.bundle.journal.length > 0);
    check("export carries the graph", exported.bundle.nodes.length >= 3);

    // --- Bad requests -------------------------------------------------------
    setSession(sessionFor(userA));
    check(
      "an empty ops array is rejected",
      (await api.MUTATE(jsonReq(ORIGIN, "POST", { ops: [] }), ctx(projectId))).status === 400,
    );
    check(
      "an unknown op name is rejected",
      (await api.MUTATE(jsonReq(ORIGIN, "POST", { ops: [{ op: "drop_table" }] }), ctx(projectId))).status === 400,
    );

    // --- Payload caps -------------------------------------------------------
    // MAX_OPS bounds the op COUNT, never the byte count: a single create_node
    // carries free-form `metadata`, so one op can be arbitrarily large. Without
    // the size check these two routes could grow a hosted snapshot past the
    // ceiling `PUT …/bundle` still enforces — the project would stop
    // round-tripping through its own export.
    {
      const fatNode = node("V-fat", "view", { metadata: { blob: "x".repeat(6 * 1024 * 1024) } });
      const fatMutation = await api.MUTATE(
        jsonReq(ORIGIN, "POST", { ops: [{ op: "create_node", node: fatNode }] }),
        ctx(projectId),
      );
      check(
        "an over-cap mutations body is refused with 413 before JSON.parse",
        fatMutation.status === 413,
        String(fatMutation.status),
      );
      check("the over-cap body reports the limit it broke", (await fatMutation.json()).limit === 5 * 1024 * 1024);

      const fatPatch = await api.PATCH_PROJECT(
        jsonReq(ORIGIN, "PATCH", { project: { description: "x".repeat(6 * 1024 * 1024) } }),
        ctx(projectId),
      );
      check("an over-cap PATCH body is refused with 413", fatPatch.status === 413, String(fatPatch.status));

      // Under the cap the same routes behave exactly as before — the check is a
      // ceiling, not a new refusal.
      const okPatch = await api.PATCH_PROJECT(
        jsonReq(ORIGIN, "PATCH", { project: { description: "y".repeat(512 * 1024) } }),
        ctx(projectId),
      );
      check("an under-cap PATCH still applies (200)", okPatch.status === 200, String(okPatch.status));
      const okMutation = await api.MUTATE(
        jsonReq(ORIGIN, "POST", { ops: [{ op: "create_node", node: node("V-slim", "view") }] }),
        ctx(projectId),
      );
      check("an under-cap mutation still applies (200)", okMutation.status === 200, String(okMutation.status));
    }

    // --- Limits -------------------------------------------------------------
    await client.query(`update users set tier = 'synk' where id = $1`, [userA]);
    const limitResult = await store.applyMutation({
      projectId,
      ownerIds: [ownerA],
      ops: Array.from({ length: 3 }, (_, i) => ({ op: "create_node", node: node(`V-bulk${i}`, "view") })),
      actor: "test",
      tier: "synk",
    });
    check("a mutation within the entity cap succeeds", limitResult.ok === true);
    const overLimit = await store.applyMutation({
      projectId,
      ownerIds: [ownerA],
      ops: [{ op: "create_node", node: node("V-over", "view") }],
      actor: "test",
      tier: "nonexistent-tier",
    });
    // An unknown tier falls back to the most restrictive row, which still allows
    // this small graph — the assertion is that the fallback resolves at all.
    check("an unknown tier resolves to the safe floor rather than throwing", typeof overLimit.ok === "boolean");

    // The project-count cap holds under concurrency. Sequentially it always
    // held; the count used to run BEFORE `withTransaction` opened, so six
    // simultaneous creates from an owner with none all read zero and all
    // inserted — the cap simply did not exist for a burst. A fresh user, so
    // this is measured from a known-empty count rather than userA's running
    // total. `createProject` now counts under a per-owner advisory lock inside
    // the transaction it writes in.
    {
      const userC = await seedUser(client, "burst");
      await owners.resolveOwnerIds(userC);
      setSession(sessionFor(userC));
      const cap = 3; // HOSTED_LIMITS.synk.projects
      const burst = await Promise.all(
        Array.from({ length: 6 }, (_, i) =>
          api.CREATE_PROJECT(
            jsonReq(`${ORIGIN}/api/graph/projects`, "POST", bundle([node(`V-burst${i}`, "view")])),
          ),
        ),
      );
      const createdCount = burst.filter((res) => res.status === 201).length;
      const refused = burst.filter((res) => res.status === 403).length;
      check(`a 6-create burst stops at the ${cap}-project cap`, createdCount === cap, `created ${createdCount}`);
      check("the rest of the burst is refused 403", refused === 6 - cap, `refused ${refused}`);
      const { rows: stored } = await client.query(
        `select count(*)::int as n from graph_projects where owner_id = $1 and archived_at is null`,
        [`own-u${userC}`],
      );
      check("and the database agrees — no extra project was written", stored[0].n === cap, `rows ${stored[0].n}`);
    }

    // --- PUT .../bundle: whole-bundle restore (Task 11) ----------------------
    // The one destructive verb in the graph API. lib/services/graph/restore.ts's
    // own suite (tests/services/graph-restore.test.js) covers the PURE decision
    // rules with no database in reach; this is the one place the SQL-coupled
    // half — row locking, REPLACING the journal rather than appending to it,
    // the version bump, owner scoping, dry-run writing nothing — gets
    // exercised at all. This machine has no local Postgres to run this file,
    // so these checks are verified in CI's Postgres-backed `services` job.
    // NOTE — project-count boundary: userA already owns 2 active projects at
    // this point (`created` and `firstImport`, both created earlier in this
    // file and neither archived yet — the Archive section below runs AFTER
    // this whole block). The synk tier caps at 3 projects, so the CREATE_PROJECT
    // call immediately below (`existing=2, +1=3, 3>3` is false) lands EXACTLY
    // on that cap, with zero headroom left for userA. This is deliberate and
    // currently harmless, but fragile: adding one more userA project anywhere
    // earlier in this file would flip this from "succeeds at the boundary" to
    // "fails the project-count limit" and break this section for a reason
    // that has nothing to do with what it's testing. If that happens, either
    // archive one of the earlier projects first or create this fixture under
    // a session with headroom.
    setSession(sessionFor(userA));
    const restoreSeed = bundle([node("V-restore-old", "view")]);
    restoreSeed.journal = [
      {
        id: "01RESTOREOLD00000000000000",
        ts: "2026-01-01T00:00:00.000Z",
        actor: "seed",
        type: "node.created",
        node_id: "V-restore-old",
        species: "view",
        title: "Old",
      },
    ];
    const restoreCreated = await api.CREATE_PROJECT(jsonReq(`${ORIGIN}/api/graph/projects`, "POST", restoreSeed));
    const restoreCreatedBody = await restoreCreated.json();
    check(
      "restore fixture project imports",
      restoreCreated.status === 201,
      `${restoreCreated.status} ${JSON.stringify(restoreCreatedBody)}`,
    );
    const restoreId = restoreCreatedBody.id;

    const restoreBundle = bundle([node("V-restore-new", "view")]);
    restoreBundle.journal = [
      {
        id: "01RESTORENEW00000000000000",
        ts: "2026-01-02T00:00:00.000Z",
        actor: "seed",
        type: "node.created",
        node_id: "V-restore-new",
        species: "view",
        title: "New",
      },
    ];
    const putReq = (body, headers = {}) =>
      new Request(`${ORIGIN}/api/graph/projects/${restoreId}/bundle`, {
        method: "PUT",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ bundle: body }),
      });

    // Missing If-Match -> 428 Precondition Required
    const noIfMatch = await api.PUT_BUNDLE(putReq(restoreBundle), ctx(restoreId));
    check("PUT bundle with no If-Match is refused with 428", noIfMatch.status === 428, String(noIfMatch.status));

    // Unsupported shape (wildcard) -> 400, not treated as stale
    const wildcard = await api.PUT_BUNDLE(putReq(restoreBundle, { "if-match": "*" }), ctx(restoreId));
    check("PUT bundle with a wildcard If-Match is refused with 400", wildcard.status === 400, String(wildcard.status));

    // Well-formed but wrong version -> 412, carrying the CURRENT version
    const stalePut = await api.PUT_BUNDLE(putReq(restoreBundle, { "if-match": '"999999"' }), ctx(restoreId));
    const stalePutBody = await stalePut.json();
    check("PUT bundle with a stale If-Match is refused with 412", stalePut.status === 412, String(stalePut.status));
    check("the 412 reports the current version", stalePutBody.current === "1", JSON.stringify(stalePutBody));

    // Owner scoping: another owner gets 404 (not 403, not 412) even with a
    // syntactically correct version — indistinguishable from not existing.
    setSession(sessionFor(userB));
    const otherPut = await api.PUT_BUNDLE(putReq(restoreBundle, { "if-match": '"1"' }), ctx(restoreId));
    check("another owner cannot restore (404)", otherPut.status === 404, String(otherPut.status));
    setSession(sessionFor(userA));

    // Scope enforcement: a graph:read token cannot destroy. This is the guard
    // standing between a read-only agent credential and wholesale replacement
    // — the one test I'd least want missing on the destructive verb.
    const readOnlyPut = await api.PUT_BUNDLE(
      putReq(restoreBundle, { "if-match": '"1"', ...bearer(readOnly.plaintext) }),
      ctx(restoreId),
    );
    check(
      "a graph:read token cannot PUT_BUNDLE (403 insufficient_scope)",
      readOnlyPut.status === 403,
      String(readOnlyPut.status),
    );

    // dryRun fails CLOSED: an unrecognized token is refused (400), never
    // silently treated as a real write. classifyDryRun's own suite
    // (tests/services/graph-restore.test.js) covers every token; this proves
    // the ROUTE actually wires it in rather than reimplementing the check.
    const badDryRun = await api.PUT_BUNDLE(
      new Request(`${ORIGIN}/api/graph/projects/${restoreId}/bundle?dryRun=yes`, {
        method: "PUT",
        headers: { "content-type": "application/json", "if-match": '"1"' },
        body: JSON.stringify({ bundle: restoreBundle }),
      }),
      ctx(restoreId),
    );
    check(
      "an unrecognized ?dryRun value is refused with 400, not treated as a write",
      badDryRun.status === 400,
      String(badDryRun.status),
    );

    // Payload cap: mirrors POST /api/graph/projects — an oversized body is
    // refused before it is ever JSON.parsed, and journal-carrying restore
    // bodies are the largest this API accepts, so this is the route that
    // needed the cap most, not least.
    const oversized = await api.PUT_BUNDLE(
      new Request(`${ORIGIN}/api/graph/projects/${restoreId}/bundle`, {
        method: "PUT",
        headers: { "content-type": "application/json", "if-match": '"1"' },
        body: JSON.stringify({ bundle: restoreBundle, padding: "x".repeat(6 * 1024 * 1024) }),
      }),
      ctx(restoreId),
    );
    check("an oversized body is refused with 413 before JSON.parse", oversized.status === 413, String(oversized.status));

    // A BARE ?dryRun (no `=value` at all) also means preview, not a real
    // write — the empty-string case classifyDryRun's own suite covers in
    // isolation; this is the route's wiring of it.
    const bareDryRun = await api.PUT_BUNDLE(
      new Request(`${ORIGIN}/api/graph/projects/${restoreId}/bundle?dryRun`, {
        method: "PUT",
        headers: { "content-type": "application/json", "if-match": '"1"' },
        body: JSON.stringify({ bundle: restoreBundle }),
      }),
      ctx(restoreId),
    );
    const bareDryRunBody = await bareDryRun.json();
    check(
      "a bare ?dryRun (no value) is a preview, not a write",
      bareDryRun.status === 200 && bareDryRunBody.dryRun === true,
      `${bareDryRun.status} ${JSON.stringify(bareDryRunBody)}`,
    );
    const afterBareDryRun = await (await api.GET_PROJECT(new Request(ORIGIN), ctx(restoreId))).json();
    check(
      "the bare-?dryRun call wrote nothing either — version still 1",
      afterBareDryRun.version === "1",
      afterBareDryRun.version,
    );

    // Dry run: matching If-Match, ?dryRun=1 -> the real delta, no write
    const dryReq = new Request(`${ORIGIN}/api/graph/projects/${restoreId}/bundle?dryRun=1`, {
      method: "PUT",
      headers: { "content-type": "application/json", "if-match": '"1"' },
      body: JSON.stringify({ bundle: restoreBundle }),
    });
    const dry = await api.PUT_BUNDLE(dryReq, ctx(restoreId));
    const dryBody = await dry.json();
    check("dry-run PUT bundle returns 200", dry.status === 200, `${dry.status} ${JSON.stringify(dryBody)}`);
    check("dry-run's response is marked dryRun: true", dryBody.dryRun === true, JSON.stringify(dryBody));
    check(
      "dry-run reports the real delta (1 node added, 1 removed, journal replaced)",
      dryBody.delta?.nodesAdded === 1 &&
        dryBody.delta?.nodesRemoved === 1 &&
        dryBody.delta?.eventsAdded === 1 &&
        dryBody.delta?.eventsDropped === 1,
      JSON.stringify(dryBody.delta),
    );
    check("dry-run's version is the CURRENT version, not a freshly minted one", dryBody.version === "1", dryBody.version);

    const afterDryRun = await (await api.GET_PROJECT(new Request(ORIGIN), ctx(restoreId))).json();
    check(
      "dry-run wrote NOTHING — the snapshot is exactly as it was",
      afterDryRun.version === "1" &&
        afterDryRun.bundle.nodes.some((n) => n.id === "V-restore-old") &&
        !afterDryRun.bundle.nodes.some((n) => n.id === "V-restore-new"),
      JSON.stringify(afterDryRun.bundle.nodes.map((n) => n.id)),
    );
    const afterDryRunJournal = await (await api.GET_JOURNAL(new Request(ORIGIN), ctx(restoreId))).json();
    check(
      "dry-run left the journal untouched too",
      afterDryRunJournal.journal.length === 1 && afterDryRunJournal.journal[0].id === "01RESTOREOLD00000000000000",
      JSON.stringify(afterDryRunJournal.journal),
    );

    // The real thing: matching If-Match, no dryRun -> writes, bumps the version
    const realPut = await api.PUT_BUNDLE(putReq(restoreBundle, { "if-match": '"1"' }), ctx(restoreId));
    const realPutBody = await realPut.json();
    check(
      "PUT bundle with a matching If-Match succeeds (200)",
      realPut.status === 200,
      `${realPut.status} ${JSON.stringify(realPutBody)}`,
    );
    check("the version bumped to 2 (a bigint increment, not a random hex string)", realPutBody.version === "2", realPutBody.version);
    check("the response ETag matches the new version", realPut.headers.get("etag") === '"2"');
    check("the real response is marked dryRun: false", realPutBody.dryRun === false, JSON.stringify(realPutBody));
    check(
      "the response delta shows the replace (1 added, 1 removed)",
      realPutBody.delta?.nodesAdded === 1 && realPutBody.delta?.nodesRemoved === 1,
      JSON.stringify(realPutBody.delta),
    );

    const afterRestore = await (await api.GET_PROJECT(new Request(ORIGIN), ctx(restoreId))).json();
    check(
      "the snapshot was REPLACED wholesale — old node gone, new node present",
      !afterRestore.bundle.nodes.some((n) => n.id === "V-restore-old") &&
        afterRestore.bundle.nodes.some((n) => n.id === "V-restore-new"),
      JSON.stringify(afterRestore.bundle.nodes.map((n) => n.id)),
    );
    const afterRestoreJournal = await (await api.GET_JOURNAL(new Request(ORIGIN), ctx(restoreId))).json();
    check(
      "the journal was REPLACED, not appended to — old event gone, new event present, count stays 1",
      afterRestoreJournal.journal.length === 1 && afterRestoreJournal.journal[0].id === "01RESTORENEW00000000000000",
      JSON.stringify(afterRestoreJournal.journal),
    );

    const restoreRow = await client.query(`select entity_count from graph_projects where id = $1`, [restoreId]);
    check(
      "entity_count reflects the new snapshot (1 node, 0 edges), matching checkHostedEntityLimit's count",
      Number(restoreRow.rows[0]?.entity_count) === 1,
      JSON.stringify(restoreRow.rows[0]),
    );

    // A second restore re-using the now-superseded version fails with 412.
    // This test is SEQUENTIAL, not concurrent, so it proves the version bump
    // from the real restore above actually PERSISTED and is visible to a
    // later, separate request — not that two transactions racing each other
    // were serialized by the row lock, which no sequential test can show.
    const secondStale = await api.PUT_BUNDLE(putReq(restoreBundle, { "if-match": '"1"' }), ctx(restoreId));
    check("re-using a since-superseded version now gets 412", secondStale.status === 412, String(secondStale.status));

    // Entity limit: a bundle over the HOSTED tier cap is refused (403 — the
    // same code POST /api/graph/projects and POST .../mutations use for a
    // tier-limit refusal; 413 on this route is reserved for the payload-size
    // cap tested above) and writes nothing — checkHostedEntityLimit gates
    // before the transaction even opens, so there is no partial write to
    // check for.
    await client.query(`update users set tier = 'synk' where id = $1`, [userA]);
    const overCapBundle = bundle(Array.from({ length: 5001 }, (_, i) => node(`V-restore-bulk${i}`, "view")));
    const overCap = await api.PUT_BUNDLE(putReq(overCapBundle, { "if-match": '"2"' }), ctx(restoreId));
    const overCapBody = await overCap.json();
    check(
      "a bundle over the hosted entity cap is refused with 403, not 413",
      overCap.status === 403,
      `${overCap.status} ${JSON.stringify(overCapBody)}`,
    );
    check("the 403 reports the HOSTED limit (5000), not the Synk backup limit (250)", overCapBody.limit === 5000, JSON.stringify(overCapBody));
    const afterOverCap = await (await api.GET_PROJECT(new Request(ORIGIN), ctx(restoreId))).json();
    check("the over-cap attempt wrote nothing — version is still 2", afterOverCap.version === "2", afterOverCap.version);

    // --- Archive ------------------------------------------------------------
    const archived = await api.DELETE_PROJECT(new Request(ORIGIN), ctx(projectId));
    check("DELETE archives the project", archived.status === 204, String(archived.status));
    const afterArchive = (await (await api.LIST_PROJECTS(new Request(ORIGIN))).json()).projects.map((p) => p.id);
    check("an archived project leaves the listing", !afterArchive.includes(projectId), afterArchive.join(","));
    check("archiving one project does not hide the others", afterArchive.includes(firstId), afterArchive.join(","));
    check(
      "an archived project cannot be mutated",
      (await api.MUTATE(jsonReq(ORIGIN, "POST", { ops: [{ op: "create_node", node: node("V-z", "view") }] }), ctx(projectId))).status === 404,
    );
    check(
      "DELETE is idempotent-safe (second call 404s)",
      (await api.DELETE_PROJECT(new Request(ORIGIN), ctx(projectId))).status === 404,
    );
  } finally {
    await cleanup(client);
    await client.end();
    fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll graph-API checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
