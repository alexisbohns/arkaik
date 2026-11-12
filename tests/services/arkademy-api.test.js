#!/usr/bin/env node

/**
 * Integration tests for the Arkademy read side and the upload script's
 * database half (docs/spec/services.md § Arkademy): GET /api/arkademy and
 * getArkademy against a real, migrated Postgres, with versions written by
 * scripts/arkademy/upload.js's publishDocument and rollbackDocument.
 *
 * Needs DATABASE_URL (the CI services job sets it; locally, a scratch cluster
 * migrated with `npm run db:migrate`). It TRUNCATES arkademy_documents, so it
 * refuses any host but this machine.
 */

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
const { loadArkademyApi, cleanup } = require("./load-arkademy-api");
const { cleanup: cleanupUploadBuild } = require("../../scripts/arkademy/load-arkademy-lib");

const ROOT = path.join(__dirname, "..", "..");
const FIXTURE = path.join(ROOT, "tests", "fixtures", "arkademy", "document.json");
const ORIGIN = "https://arkademy.test";
// A short CDN window: the data cache behind the route is the long one, and a
// publish clears it at once through POST /api/arkademy/revalidate.
const READY_CACHE = "public, max-age=60, s-maxage=60, stale-while-revalidate=60";

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`PASS: ${name}`);
  else {
    failures++;
    console.log(`FAIL: ${name}${detail === undefined ? "" : ` — ${detail}`}`);
  }
}

const fixture = () => JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
const request = (headers = {}) => new Request(`${ORIGIN}/api/arkademy`, { headers });

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error(
      "\n[arkademy-api.test] DATABASE_URL is not set. These integration tests need a migrated Postgres " +
        "(the CI services job sets it; locally, start one and run `npm run db:migrate` first). Refusing to pass silently.",
    );
    process.exit(1);
  }
  // The host the driver will connect to (a ?host= parameter and PGHOST count),
  // judged by the upload script's own guard.
  const { isLocalHost } = require("../../scripts/arkademy/upload.js");
  const resolvedHost = String(new Client({ connectionString }).host);
  if (!isLocalHost(resolvedHost)) {
    console.error(`\n[arkademy-api.test] this suite truncates arkademy_documents; it runs against this machine only, not ${resolvedHost}.`);
    process.exit(1);
  }

  const api = loadArkademyApi();
  const { GET } = api;
  const { getArkademy, arkademyEtag, ARKADEMY_CACHE_SECONDS, ARKADEMY_CACHE_TAG } = api.arkademy;
  const { ARKADEMY_FORMAT_VERSION, ARKADEMY_SCHEMA_REVISION } = api.schema;
  // The validator carries the format and the schema revision, so a deploy that
  // changes either never answers 304 to a body the old build served.
  const TAG = (version) => `W/"arkademy.${version}.f${ARKADEMY_FORMAT_VERSION}.s${ARKADEMY_SCHEMA_REVISION}"`;
  const upload = require("../../scripts/arkademy/upload.js");
  const client = new Client({ connectionString });
  await client.connect();
  const rowCount = async () => (await client.query("select count(*)::int as n from arkademy_documents")).rows[0].n;

  // Collects what the loader logs, so a check can prove no document text leaks into a log line.
  const logged = [];
  const realError = console.error;
  console.error = (...args) => logged.push(args.join(" "));

  try {
    await client.query("truncate arkademy_documents");

    check("the cache period is one hour", ARKADEMY_CACHE_SECONDS === 3600);
    check("the cache tag", ARKADEMY_CACHE_TAG === "arkademy");
    check("the validator names the version, the format and the schema revision", arkademyEtag(7) === 'W/"arkademy.7.f1.s1"', arkademyEtag(7));
    check("the validator follows the two constants", arkademyEtag(7) === TAG(7));

    // --- Not configured ----------------------------------------------------
    delete process.env.DATABASE_URL;
    try {
      const lookup = await getArkademy();
      check("unconfigured: getArkademy says so", lookup.status === "unconfigured", JSON.stringify(lookup));
      const res = await GET(request());
      const body = await res.json();
      check("unconfigured: 503", res.status === 503, `status ${res.status}`);
      check("unconfigured: the services_unavailable body", body.error === "services_unavailable" && /Arkademy/.test(body.message), JSON.stringify(body));
      check("unconfigured: never cached", res.headers.get("cache-control") === "no-store", res.headers.get("cache-control"));
    } finally {
      process.env.DATABASE_URL = connectionString;
    }

    // --- Empty table -------------------------------------------------------
    {
      const lookup = await getArkademy();
      check("empty: getArkademy says so", lookup.status === "empty", JSON.stringify(lookup));
      const res = await GET(request());
      const body = await res.json();
      check("empty: 404 no_document", res.status === 404 && body.error === "no_document", `${res.status} ${JSON.stringify(body)}`);
      check("empty: cached for a minute", res.headers.get("cache-control") === "public, max-age=60, s-maxage=60", res.headers.get("cache-control"));
      check("empty: no ETag", res.headers.get("etag") === null);
    }

    // --- Publish v1 --------------------------------------------------------
    const v1 = await upload.publishDocument(client, fixture(), { note: "first" });
    check("publish: the fixture becomes v1", v1.status === "published" && v1.version === 1, JSON.stringify(v1));
    check("publish: one row", (await rowCount()) === 1);
    {
      const lookup = await getArkademy();
      check(
        "ready: getArkademy returns the validated document",
        lookup.status === "ready" && lookup.version === 1 && JSON.stringify(lookup.document) === JSON.stringify(fixture()),
        JSON.stringify(lookup).slice(0, 200),
      );
      check("ready: uploadedAt is an ISO string", lookup.status === "ready" && new Date(lookup.uploadedAt).toISOString() === lookup.uploadedAt);

      const res = await GET(request());
      const body = await res.json();
      check("ready: 200", res.status === 200, `status ${res.status}`);
      check("ready: version 1, format 1", body.version === 1 && body.format_version === 1, JSON.stringify({ ...body, document: undefined }));
      check("ready: uploaded_at is ISO 8601", new Date(body.uploaded_at).toISOString() === body.uploaded_at, body.uploaded_at);
      check("ready: the document as validated", JSON.stringify(body.document) === JSON.stringify(fixture()));
      check("ready: ETag W/\"arkademy.1.f1.s1\"", res.headers.get("etag") === TAG(1), res.headers.get("etag"));
      check("ready: CDN-cacheable", res.headers.get("cache-control") === READY_CACHE, res.headers.get("cache-control"));
    }
    {
      const res = await GET(request({ "if-none-match": TAG(1) }));
      check("conditional: a matching tag gets 304", res.status === 304, `status ${res.status}`);
      check("conditional: with no body", (await res.text()) === "");
      check("conditional: the same validator and caching", res.headers.get("etag") === TAG(1) && res.headers.get("cache-control") === READY_CACHE);
      const stale = await GET(request({ "if-none-match": TAG(0) }));
      check("conditional: another tag gets the body", stale.status === 200, `status ${stale.status}`);
      const oldShape = await GET(request({ "if-none-match": 'W/"arkademy.1"' }));
      check("conditional: a tag without the format and revision gets the body", oldShape.status === 200, `status ${oldShape.status}`);
      const otherRevision = await GET(request({ "if-none-match": `W/"arkademy.1.f${ARKADEMY_FORMAT_VERSION}.s${ARKADEMY_SCHEMA_REVISION + 1}"` }));
      check("conditional: a tag from another schema revision gets the body", otherRevision.status === 200, `status ${otherRevision.status}`);
    }

    // --- Publishing again --------------------------------------------------
    {
      const same = await upload.publishDocument(client, fixture(), { note: "again" });
      check("unchanged: nothing is written", same.status === "unchanged" && same.version === 1 && (await rowCount()) === 1, JSON.stringify(same));
      const reordered = fixture();
      reordered.companies[0] = Object.fromEntries(Object.entries(reordered.companies[0]).reverse());
      const again = await upload.publishDocument(client, reordered, {});
      check("unchanged: key order does not count as a change", again.status === "unchanged" && (await rowCount()) === 1, JSON.stringify(again));

      const broken = fixture();
      broken.uses[0].entity = "nothing-here";
      const refused = await upload.publishDocument(client, broken, {});
      check(
        "invalid: refused with the path, nothing written",
        refused.status === "invalid" && refused.errors.some((finding) => finding.path === "uses[0].entity") && (await rowCount()) === 1,
        JSON.stringify(refused),
      );

      for (const [name, char] of [["a NUL", "\u0000"], ["a lone surrogate", "\ud800"]]) {
        const poisoned = fixture();
        poisoned.uses[0].text = `house${char}holds`;
        const outcome = await upload.publishDocument(client, poisoned, {});
        check(
          `invalid: ${name} is refused before Postgres sees it`,
          outcome.status === "invalid" && outcome.errors.some((finding) => finding.path === "uses[0].text") && (await rowCount()) === 1,
          JSON.stringify(outcome),
        );
      }

      const changed = fixture();
      changed.companies[1].oneLiner = "Tide tables for shore anglers";
      const v2 = await upload.publishDocument(client, changed, { note: "second" });
      check("changed: becomes v2", v2.status === "published" && v2.version === 2, JSON.stringify(v2));
      const res = await GET(request({ "if-none-match": TAG(1) }));
      const body = await res.json();
      check("changed: the old tag no longer matches", res.status === 200 && res.headers.get("etag") === TAG(2), `${res.status} ${res.headers.get("etag")}`);
      check("changed: the route serves v2", body.version === 2 && body.document.companies[1].oneLiner === "Tide tables for shore anglers");
    }

    // --- Rollback ------------------------------------------------------------
    {
      const v3 = await upload.rollbackDocument(client, {});
      check("rollback: writes v3 from v1", v3.status === "rolled-back" && v3.version === 3 && v3.to === 1, JSON.stringify(v3));
      const { rows } = await client.query("select version, sha256, restored_from, note from arkademy_documents order by version");
      check("rollback: v3 carries v1's hash", rows[2].sha256 === rows[0].sha256 && rows[2].sha256 !== rows[1].sha256);
      check("rollback: restored_from = 1, with a note", rows[2].restored_from === 1 && rows[2].note === "rollback to v1", JSON.stringify(rows[2]));
      const res = await GET(request());
      const body = await res.json();
      check("rollback: the route serves v1's document as v3", body.version === 3 && JSON.stringify(body.document) === JSON.stringify(fixture()));

      const same = await upload.rollbackDocument(client, { to: 1 });
      check("rollback: to a version holding the current document changes nothing", same.status === "unchanged" && (await rowCount()) === 3, JSON.stringify(same));
      const missing = await upload.rollbackDocument(client, { to: 99 });
      check("rollback: to a version that does not exist", missing.status === "missing" && missing.to === 99, JSON.stringify(missing));
      const v4 = await upload.rollbackDocument(client, {});
      check("rollback: is itself undoable — the default target skips v1's twin", v4.status === "rolled-back" && v4.version === 4 && v4.to === 2, JSON.stringify(v4));

      const versions = await upload.listVersions(client, 10);
      check(
        "status: newest first, with restored_from",
        JSON.stringify(versions.map((row) => [row.version, row.restoredFrom])) === JSON.stringify([[4, 2], [3, 1], [2, null], [1, null]]),
        JSON.stringify(versions.map((row) => [row.version, row.restoredFrom])),
      );
      check("status: the limit is honoured", (await upload.listVersions(client, 2)).length === 2);
    }

    // --- A stored row today's schema refuses -----------------------------------
    {
      await client.query(
        `insert into arkademy_documents (version, format_version, document, sha256, size_bytes)
         values (5, 1, '{"formatVersion": 1, "tools": []}'::jsonb, 'by-hand', 33)`,
      );
      logged.length = 0;
      const lookup = await getArkademy();
      check("invalid: getArkademy names the version", lookup.status === "invalid" && lookup.version === 5, JSON.stringify(lookup));
      const res = await GET(request());
      const body = await res.json();
      check("invalid: 500 document_invalid", res.status === 500 && body.error === "document_invalid", `${res.status} ${JSON.stringify(body)}`);
      check("invalid: never cached", res.headers.get("cache-control") === "no-store");
      check("invalid: the log names the version", logged.some((line) => line.includes("v5")), JSON.stringify(logged));
      const refused = await upload.rollbackDocument(client, { to: 5 });
      check("rollback: refuses a version today's schema refuses", refused.status === "invalid" && (await rowCount()) === 5, JSON.stringify(refused).slice(0, 200));

      await client.query(
        `insert into arkademy_documents (version, format_version, document, sha256, size_bytes)
         values (6, 99, $1::jsonb, 'by-hand', 1)`,
        [JSON.stringify(fixture())],
      );
      logged.length = 0;
      const future = await getArkademy();
      check("format 99: getArkademy refuses it", future.status === "invalid" && future.version === 6, JSON.stringify(future));
      const futureRes = await GET(request());
      check("format 99: 500 document_invalid", futureRes.status === 500 && (await futureRes.json()).error === "document_invalid");
      check("format 99: the log holds no document text", logged.length > 0 && logged.every((line) => !line.includes("Tidewise")), JSON.stringify(logged));
    }

    // --- Postgres fails ------------------------------------------------------
    {
      const realQuery = api.db.query;
      api.db.query = async () => {
        throw new Error("connection terminated");
      };
      try {
        const lookup = await getArkademy();
        check("error: getArkademy catches it", lookup.status === "error", JSON.stringify(lookup));
        const res = await GET(request());
        const body = await res.json();
        check("error: 500 internal_error", res.status === 500 && body.error === "internal_error", JSON.stringify(body));
        check("error: never cached", res.headers.get("cache-control") === "no-store");
      } finally {
        api.db.query = realQuery;
      }
    }

    // --- Which path getArkademy takes ------------------------------------------
    {
      const { created, calls } = api.nextCache;
      check(
        "cache: one wrapper, keyed by the format and the schema revision, tagged, one hour",
        created.length === 1 &&
          JSON.stringify(created[0].keyParts) ===
            JSON.stringify(["arkademy-current", `format-${ARKADEMY_FORMAT_VERSION}`, `schema-${ARKADEMY_SCHEMA_REVISION}`]) &&
          created[0].options.revalidate === 3600 &&
          JSON.stringify(created[0].options.tags) === JSON.stringify(["arkademy"]),
        JSON.stringify(created),
      );
      const before = calls.length;
      await getArkademy();
      check("cache: development reads Postgres directly", calls.length === before);
      const savedEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      try {
        await getArkademy();
        check("cache: production reads through the data cache", calls.length === before + 1);
      } finally {
        if (savedEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = savedEnv;
      }
    }
    // --- POST /api/arkademy/revalidate -------------------------------------------
    {
      const { POST } = api.revalidate;
      const { revalidated } = api.nextCache;
      const SECRET = "a-long-random-secret-for-the-suite";
      const post = (headers = {}) => POST(new Request(`${ORIGIN}/api/arkademy/revalidate`, { method: "POST", headers }));
      const savedSecret = process.env.ARKADEMY_REVALIDATE_SECRET;
      try {
        delete process.env.ARKADEMY_REVALIDATE_SECRET;
        revalidated.length = 0;
        const hidden = await post({ authorization: `Bearer ${SECRET}` });
        check("revalidate: with no secret on the server, 404", hidden.status === 404, `status ${hidden.status}`);
        check("revalidate: and nothing is revalidated", revalidated.length === 0);
        check("revalidate: the 404 is never cached", hidden.headers.get("cache-control") === "no-store");

        process.env.ARKADEMY_REVALIDATE_SECRET = SECRET;
        for (const [name, headers] of [
          ["no Authorization", {}],
          ["a wrong token", { authorization: "Bearer not-the-secret" }],
          ["a token of another length", { authorization: `Bearer ${SECRET}x` }],
          ["the secret without the Bearer scheme", { authorization: SECRET }],
          ["Basic credentials", { authorization: `Basic ${Buffer.from(`x:${SECRET}`).toString("base64")}` }],
          ["an empty bearer", { authorization: "Bearer " }],
        ]) {
          revalidated.length = 0;
          const res = await post(headers);
          check(`revalidate: ${name} gets 401`, res.status === 401 && revalidated.length === 0, `status ${res.status}, ${revalidated.length} revalidated`);
          check(`revalidate: ${name}: never cached, with a Bearer challenge`, res.headers.get("cache-control") === "no-store" && /^Bearer/.test(res.headers.get("www-authenticate") ?? ""));
        }
        revalidated.length = 0;
        const ok = await post({ authorization: `Bearer ${SECRET}` });
        check("revalidate: the right token gets 204 with no body", ok.status === 204 && (await ok.text()) === "", `status ${ok.status}`);
        check(
          "revalidate: it expires the arkademy tag at once (not stale-while-revalidate)",
          JSON.stringify(revalidated) === JSON.stringify([{ tag: "arkademy", profile: { expire: 0 } }]),
          JSON.stringify(revalidated),
        );
        check("revalidate: the 204 is never cached", ok.headers.get("cache-control") === "no-store");
        const lower = await post({ authorization: `bearer ${SECRET}` });
        check("revalidate: the scheme is case-insensitive", lower.status === 204, `status ${lower.status}`);
        check("revalidate: only POST is exported", typeof api.revalidate.GET === "undefined");
      } finally {
        if (savedSecret === undefined) delete process.env.ARKADEMY_REVALIDATE_SECRET;
        else process.env.ARKADEMY_REVALIDATE_SECRET = savedSecret;
      }
    }

    // --- The upload script makes a write live --------------------------------------
    // A stub site on this machine stands in for the deployment's revalidate route.
    {
      await client.query("truncate arkademy_documents");
      const http = require("http");
      const os = require("os");
      const { spawn } = require("child_process");
      const SECRET = "stub-site-secret";
      const hits = [];
      const site = http.createServer((req, res) => {
        hits.push({ method: req.method, url: req.url, authorization: req.headers.authorization });
        res.writeHead(req.headers.authorization === `Bearer ${SECRET}` ? 204 : 401).end();
      });
      await new Promise((resolve) => site.listen(0, "127.0.0.1", resolve));
      const siteUrl = `http://127.0.0.1:${site.address().port}`;
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arkademy-live-"));
      const runScript = (args, extraEnv) =>
        new Promise((resolve) => {
          const env = { ...process.env, DATABASE_URL: connectionString, ...extraEnv };
          delete env.PGHOST;
          for (const key of Object.keys(extraEnv)) if (extraEnv[key] === undefined) delete env[key];
          const child = spawn(process.execPath, [path.join(ROOT, "scripts", "arkademy", "upload.js"), ...args], { env });
          let stdout = "";
          let stderr = "";
          child.stdout.on("data", (chunk) => (stdout += chunk));
          child.stderr.on("data", (chunk) => (stderr += chunk));
          child.on("close", (status) => resolve({ status, stdout, stderr }));
        });
      try {
        const v1File = path.join(dir, "v1.json");
        fs.writeFileSync(v1File, JSON.stringify(fixture()));
        const quiet = await runScript(["publish", v1File], { ARKADEMY_SITE_URL: undefined, ARKADEMY_REVALIDATE_SECRET: undefined });
        check(
          "live: without the two variables the script says how long, and how to set them",
          quiet.status === 0 && /published v1\b/.test(quiet.stdout) && /within an hour/.test(quiet.stdout) && /ARKADEMY_SITE_URL/.test(quiet.stdout) && hits.length === 0,
          `${quiet.status} ${quiet.stdout} ${quiet.stderr}`,
        );
        const v2 = fixture();
        v2.companies[1].oneLiner = "Tide tables for shore anglers";
        const v2File = path.join(dir, "v2.json");
        fs.writeFileSync(v2File, JSON.stringify(v2));
        const loud = await runScript(["publish", v2File], { ARKADEMY_SITE_URL: siteUrl, ARKADEMY_REVALIDATE_SECRET: SECRET });
        check("live: with them, the script calls the site and says live now", loud.status === 0 && /published v2\b/.test(loud.stdout) && /^live now/m.test(loud.stdout), `${loud.status} ${loud.stdout} ${loud.stderr}`);
        check(
          "live: one POST to the revalidate route with the bearer token",
          hits.length === 1 && hits[0].method === "POST" && hits[0].url === "/api/arkademy/revalidate" && hits[0].authorization === `Bearer ${SECRET}`,
          JSON.stringify(hits),
        );
        check("live: the secret is never printed", !loud.stdout.includes(SECRET) && !loud.stderr.includes(SECRET));
        hits.length = 0;
        const back = await runScript(["rollback"], { ARKADEMY_SITE_URL: siteUrl, ARKADEMY_REVALIDATE_SECRET: SECRET });
        check("live: a rollback calls it too", back.status === 0 && /rolled back: v3 restores v1/.test(back.stdout) && /^live now/m.test(back.stdout) && hits.length === 1, `${back.status} ${back.stdout} ${back.stderr}`);
        hits.length = 0;
        const v4 = fixture();
        v4.companies[1].oneLiner = "Tide tables for harbour pilots";
        const v4File = path.join(dir, "v4.json");
        fs.writeFileSync(v4File, JSON.stringify(v4));
        const wrong = await runScript(["publish", v4File], { ARKADEMY_SITE_URL: siteUrl, ARKADEMY_REVALIDATE_SECRET: "not-it" });
        check(
          "live: a refused call never fails the publish, which is committed",
          wrong.status === 0 && /published v4\b/.test(wrong.stdout) && /secret does not match/.test(wrong.stdout) && !/^live now/m.test(wrong.stdout) && (await rowCount()) === 4,
          `${wrong.status} ${wrong.stdout} ${wrong.stderr}`,
        );
        site.close();
        const v5 = fixture();
        v5.companies[1].oneLiner = "Tide tables for kayakers";
        const v5File = path.join(dir, "v5.json");
        fs.writeFileSync(v5File, JSON.stringify(v5));
        const down = await runScript(["publish", v5File], { ARKADEMY_SITE_URL: siteUrl, ARKADEMY_REVALIDATE_SECRET: SECRET });
        check(
          "live: an unreachable site never fails the publish either",
          down.status === 0 && /published v5\b/.test(down.stdout) && /ECONNREFUSED/.test(down.stdout) && (await rowCount()) === 5,
          `${down.status} ${down.stdout} ${down.stderr}`,
        );
      } finally {
        site.close();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }

    // --- Six publishes at once ------------------------------------------------
    // Each spawned run builds into its own directory; the runs that lose the
    // race on the version exit 1 with a plain message, never a stack trace.
    {
      await client.query("truncate arkademy_documents");
      const os = require("os");
      const { spawn } = require("child_process");
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arkademy-race-"));
      try {
        const file = path.join(dir, "race.json");
        fs.writeFileSync(file, JSON.stringify(fixture()));
        const env = { ...process.env, DATABASE_URL: connectionString };
        delete env.PGHOST;
        delete env.ARKADEMY_SITE_URL;
        delete env.ARKADEMY_REVALIDATE_SECRET;
        const once = () =>
          new Promise((resolve) => {
            const child = spawn(process.execPath, [path.join(ROOT, "scripts", "arkademy", "upload.js"), "publish", file], { env });
            let stdout = "";
            let stderr = "";
            child.stdout.on("data", (chunk) => (stdout += chunk));
            child.stderr.on("data", (chunk) => (stderr += chunk));
            child.on("close", (status) => resolve({ status, stdout, stderr }));
          });
        // Hold the table so all six queue behind the lock, then let them go at
        // once: each reads an empty table and inserts v1, and five collide.
        const gate = new Client({ connectionString });
        await gate.connect();
        await gate.query("begin");
        await gate.query("lock table arkademy_documents in access exclusive mode");
        const pending = Array.from({ length: 6 }, once);
        const deadline = Date.now() + 60_000;
        let waiting = 0;
        while (Date.now() < deadline) {
          waiting = (
            await client.query(
              "select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'",
            )
          ).rows[0].n;
          if (waiting >= 6) break;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        check("race: all six runs queued behind the lock", waiting >= 6, `waiting ${waiting}`);
        await gate.query("commit");
        await gate.end();
        const runs = await Promise.all(pending);
        const published = runs.filter((run) => run.status === 0 && /published v1\b/.test(run.stdout));
        const clean = (run) =>
          !/\n\s+at /.test(run.stderr) &&
          ((run.status === 0 && /published v1\b|unchanged \(v1\)/.test(run.stdout)) ||
            (run.status === 1 && /another publish or rollback wrote v1 at the same moment/.test(run.stderr)));
        check("race: exactly one run publishes v1", published.length === 1, JSON.stringify(runs.map((run) => [run.status, run.stdout.split("\n").filter(Boolean).pop()])));
        check("race: every run ends cleanly", runs.every(clean), JSON.stringify(runs.filter((run) => !clean(run))).slice(0, 600));
        check("race: one row", (await rowCount()) === 1);
        const own = path.basename(require("../../scripts/arkademy/load-arkademy-lib").BUILD_DIR);
        const left = fs.readdirSync(path.join(ROOT, "scripts", "arkademy")).filter((name) => name.startsWith(".build") && name !== own);
        check("race: no run leaves its build directory behind", left.length === 0, JSON.stringify(left));
        console.log(`  (race outcomes: ${runs.map((run) => (run.status === 0 ? run.stdout.split("\n").filter(Boolean).pop() : `exit ${run.status}`)).join(" | ")})`);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  } finally {
    console.error = realError;
    await client.query("truncate arkademy_documents").catch(() => {});
    await client.end();
    await api.db.getPool().end();
    cleanup();
    cleanupUploadBuild();
  }

  if (failures > 0) {
    console.log(`\n${failures} arkademy-api test(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll arkademy-api integration tests passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
