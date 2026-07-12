#!/usr/bin/env node

/**
 * Integration tests for the Publik API (docs/spec/services.md § Publik, § CI
 * Additions). The route handlers are invoked directly with real `Request`
 * objects against a real Postgres (the CI "services" job's Postgres 16 container,
 * or a local instance) whose schema was applied by `npm run db:migrate`.
 *
 * Coverage (the acceptance list from issue #238):
 *   - create → fetch → delete round-trip
 *   - journal stripped by default
 *   - journal kept with ?include_journal=true
 *   - oversized body rejected (413)
 *   - wrong owner key rejected (403)
 *   - per-IP rate limit (429 + retry-after)
 * Plus: 422 on invalid bundle, 404 on missing id, report → 202 + flag.
 *
 * Each test uses a distinct client IP (via x-forwarded-for) so the per-IP
 * creation throttle never bleeds across cases; the rate-limit test pins one IP.
 */

const fs = require("fs");
const path = require("path");
const { randomBytes } = require("node:crypto");
const { loadPublikApi, BUILD_DIR, SCHEMA_BUILD_DIR } = require("./load-publik-api");

const ROOT = path.join(__dirname, "..", "..");
const ORIGIN = "https://publik.test";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS: ${name}`);
  } else {
    failures++;
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function readFixture(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
}

/** A fresh, non-routable client IP so each test gets its own rate-limit bucket. */
function freshIp() {
  const b = randomBytes(3);
  return `10.${b[0]}.${b[1]}.${b[2]}`;
}

function postRequest(bundle, { ip, includeJournal } = {}) {
  const qs = includeJournal ? "?include_journal=true" : "";
  return new Request(`${ORIGIN}/api/publik${qs}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip || freshIp(),
    },
    body: typeof bundle === "string" ? bundle : JSON.stringify(bundle),
  });
}

function idRequest(id, { method = "GET", bearer } = {}) {
  const headers = {};
  if (bearer) headers["authorization"] = `Bearer ${bearer}`;
  return new Request(`${ORIGIN}/api/publik/${id}`, { method, headers });
}

function ctx(id) {
  return { params: Promise.resolve({ id }) };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error(
      "\n[publik-api.test] DATABASE_URL is not set. These integration tests require a " +
        "migrated Postgres (the CI services job sets it; locally, start Postgres and " +
        "`npm run db:migrate` first). Refusing to pass silently.",
    );
    process.exit(1);
  }

  const { POST, GET, DELETE, REPORT } = loadPublikApi();
  const validBundle = readFixture("tests/fixtures/valid-bundle.json");
  const level2Bundle = readFixture("tests/fixtures/valid-level2.json");

  // --- 1. create → fetch → delete round-trip -------------------------------
  {
    const res = await POST(postRequest(validBundle, { ip: freshIp() }));
    const body = await res.json();
    check("create returns 201", res.status === 201, `status ${res.status}`);
    check("create response has url-safe id", typeof body.id === "string" && body.id.length >= 10, body.id);
    check("create id is URL-safe (base64url charset)", /^[A-Za-z0-9_-]+$/.test(body.id || ""), body.id);
    check("create response url is origin + /p/{id}", body.url === `${ORIGIN}/p/${body.id}`, body.url);
    check("owner_key is a UUID v4", UUID_V4.test(body.owner_key || ""), body.owner_key);

    const getRes = await GET(idRequest(body.id), ctx(body.id));
    const fetched = await getRes.json();
    check("fetch returns 200", getRes.status === 200, `status ${getRes.status}`);
    check("fetch returns the stored bundle verbatim", fetched.project && fetched.project.id === "test-project", JSON.stringify(fetched.project));

    const delRes = await DELETE(idRequest(body.id, { method: "DELETE", bearer: body.owner_key }), ctx(body.id));
    check("delete with owner key returns 204", delRes.status === 204, `status ${delRes.status}`);

    const getGone = await GET(idRequest(body.id), ctx(body.id));
    check("fetch after delete returns 404", getGone.status === 404, `status ${getGone.status}`);
  }

  // --- 2. journal stripped by default --------------------------------------
  {
    check("fixture level2 actually carries a journal", Array.isArray(level2Bundle.journal) && level2Bundle.journal.length > 0);
    const res = await POST(postRequest(level2Bundle, { ip: freshIp() }));
    const body = await res.json();
    check("create (with journal, default) returns 201", res.status === 201, `status ${res.status}`);
    const fetched = await (await GET(idRequest(body.id), ctx(body.id))).json();
    check("journal stripped by default", fetched.journal === undefined, JSON.stringify(fetched.journal));
    check("non-journal data survives the strip", Array.isArray(fetched.nodes) && fetched.nodes.length === level2Bundle.nodes.length);
  }

  // --- 3. journal kept with ?include_journal=true --------------------------
  {
    const res = await POST(postRequest(level2Bundle, { ip: freshIp(), includeJournal: true }));
    const body = await res.json();
    check("create (include_journal) returns 201", res.status === 201, `status ${res.status}`);
    const fetched = await (await GET(idRequest(body.id), ctx(body.id))).json();
    check(
      "journal preserved with include_journal=true",
      Array.isArray(fetched.journal) && fetched.journal.length === level2Bundle.journal.length,
      `len ${fetched.journal && fetched.journal.length}`,
    );
  }

  // --- 4. oversized body rejected (413) ------------------------------------
  {
    const oversized = JSON.stringify({ blob: "x".repeat(5 * 1024 * 1024) });
    const res = await POST(postRequest(oversized, { ip: freshIp() }));
    check("oversized body returns 413", res.status === 413, `status ${res.status}`);
  }

  // --- 5. invalid bundle rejected (422 + findings) -------------------------
  {
    const res = await POST(postRequest({ project: { title: "" }, nodes: [], edges: [] }, { ip: freshIp() }));
    const body = await res.json();
    check("invalid bundle returns 422", res.status === 422, `status ${res.status}`);
    check("422 body carries structured findings", Array.isArray(body.findings) && body.findings.length > 0, JSON.stringify(body.findings));
  }

  // --- 6. wrong owner key rejected (403) -----------------------------------
  {
    const res = await POST(postRequest(validBundle, { ip: freshIp() }));
    const body = await res.json();
    const wrong = await DELETE(idRequest(body.id, { method: "DELETE", bearer: "00000000-0000-4000-8000-000000000000" }), ctx(body.id));
    check("delete with wrong owner key returns 403", wrong.status === 403, `status ${wrong.status}`);
    // snapshot must still exist after a failed delete
    const still = await GET(idRequest(body.id), ctx(body.id));
    check("snapshot survives a failed delete", still.status === 200, `status ${still.status}`);
    // missing Authorization → 401
    const noAuth = await DELETE(idRequest(body.id, { method: "DELETE" }), ctx(body.id));
    check("delete without Authorization returns 401", noAuth.status === 401, `status ${noAuth.status}`);
    // cleanup with the real key
    await DELETE(idRequest(body.id, { method: "DELETE", bearer: body.owner_key }), ctx(body.id));
  }

  // --- 7. missing id → 404 -------------------------------------------------
  {
    const res = await GET(idRequest("does-not-exist-xxxx"), ctx("does-not-exist-xxxx"));
    check("fetch of unknown id returns 404", res.status === 404, `status ${res.status}`);
  }

  // --- 8. report → 202 + flag ----------------------------------------------
  {
    const created = await (await POST(postRequest(validBundle, { ip: freshIp() }))).json();
    const reportRes = await REPORT(idRequest(created.id, { method: "POST" }), ctx(created.id));
    const reportBody = await reportRes.json();
    check("report returns 202", reportRes.status === 202, `status ${reportRes.status}`);
    check("report increments report_count", reportBody.report_count === 1, JSON.stringify(reportBody));
    check("report not flagged below threshold", reportBody.flagged === false, JSON.stringify(reportBody));
    const missing = await REPORT(idRequest("nope-nope-nope"), ctx("nope-nope-nope"));
    check("report on unknown id returns 404", missing.status === 404, `status ${missing.status}`);
  }

  // --- 9. per-IP rate limit (429 + retry-after) ----------------------------
  {
    const ip = freshIp();
    let allowed = 0;
    let limitedRes = null;
    for (let i = 0; i < 11; i++) {
      const res = await POST(postRequest(validBundle, { ip }));
      if (res.status === 201) allowed++;
      else if (res.status === 429) {
        limitedRes = res;
        break;
      } else {
        check(`rate-limit loop unexpected status at i=${i}`, false, `status ${res.status}`);
      }
    }
    check("first 10 creations from one IP are allowed", allowed === 10, `allowed ${allowed}`);
    check("11th creation is rate-limited (429)", limitedRes !== null && limitedRes.status === 429);
    if (limitedRes) {
      const retryAfter = limitedRes.headers.get("retry-after");
      check("429 carries a numeric retry-after header", retryAfter !== null && Number(retryAfter) > 0, `retry-after ${retryAfter}`);
    }
  }

  // Cleanup transpiled build dirs (mirrors the other loaders' teardown).
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
  fs.rmSync(SCHEMA_BUILD_DIR, { recursive: true, force: true });

  if (failures > 0) {
    console.log(`\n${failures} publik-api test(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll publik-api integration tests passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
