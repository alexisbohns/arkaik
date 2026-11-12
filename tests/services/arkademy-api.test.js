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
const READY_CACHE = "public, max-age=60, s-maxage=300, stale-while-revalidate=86400";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

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
  if (!LOCAL_HOSTS.has(new URL(connectionString).hostname)) {
    console.error("\n[arkademy-api.test] this suite truncates arkademy_documents; it runs against localhost only.");
    process.exit(1);
  }

  const api = loadArkademyApi();
  const { GET } = api;
  const { getArkademy, arkademyEtag, ARKADEMY_CACHE_SECONDS } = api.arkademy;
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

    check("the cache window is five minutes", ARKADEMY_CACHE_SECONDS === 300);
    check("the validator names the version", arkademyEtag(7) === 'W/"arkademy.7"');

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
      check("ready: ETag W/\"arkademy.1\"", res.headers.get("etag") === 'W/"arkademy.1"', res.headers.get("etag"));
      check("ready: CDN-cacheable", res.headers.get("cache-control") === READY_CACHE, res.headers.get("cache-control"));
    }
    {
      const res = await GET(request({ "if-none-match": 'W/"arkademy.1"' }));
      check("conditional: a matching tag gets 304", res.status === 304, `status ${res.status}`);
      check("conditional: with no body", (await res.text()) === "");
      check("conditional: the same validator and caching", res.headers.get("etag") === 'W/"arkademy.1"' && res.headers.get("cache-control") === READY_CACHE);
      const stale = await GET(request({ "if-none-match": 'W/"arkademy.0"' }));
      check("conditional: another tag gets the body", stale.status === 200, `status ${stale.status}`);
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

      const changed = fixture();
      changed.companies[1].oneLiner = "Tide tables for shore anglers";
      const v2 = await upload.publishDocument(client, changed, { note: "second" });
      check("changed: becomes v2", v2.status === "published" && v2.version === 2, JSON.stringify(v2));
      const res = await GET(request({ "if-none-match": 'W/"arkademy.1"' }));
      const body = await res.json();
      check("changed: the old tag no longer matches", res.status === 200 && res.headers.get("etag") === 'W/"arkademy.2"', `${res.status} ${res.headers.get("etag")}`);
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
        "cache: one wrapper, keyed and tagged as specified",
        created.length === 1 &&
          JSON.stringify(created[0].keyParts) === JSON.stringify(["arkademy-current"]) &&
          created[0].options.revalidate === 300 &&
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
