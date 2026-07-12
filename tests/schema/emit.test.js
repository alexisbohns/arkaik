#!/usr/bin/env node

/**
 * Unit tests for the shared write primitives (packages/schema/src/emit.ts) and
 * the re-exported projections (packages/schema/src/projections.ts), both new in
 * issue #221. These are the browser-safe half of the journal write path that
 * `arkaik log` / `arkaik release` reuse; the CLI tests cover the fs half.
 *
 * Covers:
 *  - `ulid()` shape (26 Crockford base32 chars) and monotonicity — ids minted
 *    in the same millisecond still sort in creation order;
 *  - `makeEvent` stamps a valid envelope (ULID id, ISO ts, actor, type) and
 *    validates the payload against the matching event schema, throwing on a bad
 *    enum so a malformed event is never produced;
 *  - the projections are exported from the schema package and behave.
 */

const { loadSchema, BUILD_DIR } = require("./load-schema");
const fs = require("fs");

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS: ${name}`);
  } else {
    failures++;
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/; // Crockford base32, 26 chars.

function main() {
  const { ulid, makeEvent, computeChangelog, computeNodeTimeline, computeBacklog } = loadSchema();

  // --- ulid: shape + monotonicity -----------------------------------------
  const one = ulid();
  check("ulid() is 26 Crockford base32 chars", ULID_RE.test(one), one);

  // Monotonic across a burst (fresh timestamps): strictly increasing.
  const burst = Array.from({ length: 200 }, () => ulid());
  let strictlyIncreasing = true;
  for (let i = 1; i < burst.length; i++) {
    if (!(burst[i] > burst[i - 1])) {
      strictlyIncreasing = false;
      break;
    }
  }
  check("ulid() is strictly increasing across a burst", strictlyIncreasing);
  check("ulid() burst has no collisions", new Set(burst).size === burst.length);

  // Same millisecond (fixed seedTime) still sorts in creation order via the
  // incremented random component.
  const sameMs = Array.from({ length: 50 }, () => ulid(1_700_000_000_000));
  const sorted = [...sameMs].sort();
  check("ulid(sameMs) stays monotonic within one millisecond", JSON.stringify(sameMs) === JSON.stringify(sorted));
  check("ulid(sameMs) shares the 10-char time prefix", new Set(sameMs.map((u) => u.slice(0, 10))).size === 1);

  // --- makeEvent: envelope + validation ------------------------------------
  const ev = makeEvent("release.tagged", { version: "1.2.0", notes: "hello" }, { actor: "arkaik-cli" });
  check("makeEvent stamps a ULID id", ULID_RE.test(ev.id), ev.id);
  check("makeEvent stamps an ISO ts", typeof ev.ts === "string" && !Number.isNaN(Date.parse(ev.ts)));
  check("makeEvent stamps the actor", ev.actor === "arkaik-cli");
  check("makeEvent carries the type + payload", ev.type === "release.tagged" && ev.version === "1.2.0" && ev.notes === "hello");

  // ts override (Date + string) is honored.
  const withDate = makeEvent("release.tagged", { version: "1" }, { ts: new Date("2026-01-02T03:04:05.000Z") });
  check("makeEvent honors a Date ts", withDate.ts === "2026-01-02T03:04:05.000Z");
  const withStr = makeEvent("release.tagged", { version: "1" }, { ts: "2026-05-05T00:00:00.000Z", id: "01ARZ3NDEKTSV4RRFFQ69G5FAV" });
  check("makeEvent honors a string ts + id override", withStr.ts === "2026-05-05T00:00:00.000Z" && withStr.id === "01ARZ3NDEKTSV4RRFFQ69G5FAV");

  // No actor → no actor key.
  const noActor = makeEvent("release.tagged", { version: "9" });
  check("makeEvent omits actor when not given", noActor.actor === undefined);

  // A validated known event with a bad enum throws (never produced).
  let threw = false;
  try {
    makeEvent("release.tagged", { version: "1", platform: "windows" });
  } catch {
    threw = true;
  }
  check("makeEvent throws on an invalid enum payload", threw);

  // A required-field violation throws too.
  let threwMissing = false;
  try {
    makeEvent("node.created", { node_id: "V-x" }); // missing species + title
  } catch {
    threwMissing = true;
  }
  check("makeEvent throws on a missing required field", threwMissing);

  // An unknown type falls back to the lenient envelope and round-trips.
  const unknown = makeEvent("custom.thing", { foo: "bar" });
  check("makeEvent tolerates an unknown type via the lenient envelope", unknown.type === "custom.thing" && unknown.foo === "bar");

  // --- projections re-exported from the schema package --------------------
  const events = [
    { id: "01A", ts: "2026-01-01T00:00:00.000Z", type: "node.created", node_id: "V-a", species: "view", title: "A" },
    { id: "01E", ts: "2026-01-02T00:00:00.000Z", type: "release.tagged", version: "1.0" },
    { id: "01F", ts: "2026-01-03T00:00:00.000Z", type: "node.status_changed", node_id: "V-a", from: "idea", to: "live" },
    { id: "01G", ts: "2026-01-03T01:00:00.000Z", type: "release.tagged", version: "1.1" },
  ];
  const cl = computeChangelog(events, "1.1");
  check("computeChangelog is exported and slices between markers", cl.fromVersion === "1.0" && cl.events.map((e) => e.id).join(",") === "01F", JSON.stringify(cl));
  check("computeNodeTimeline is exported", computeNodeTimeline(events, "V-a").map((e) => e.id).join(",") === "01A,01F");
  check("computeBacklog is exported", Array.isArray(computeBacklog(events).items));

  fs.rmSync(BUILD_DIR, { recursive: true, force: true });

  if (failures > 0) {
    console.log(`\n${failures} emit/projection test(s) failed.`);
    process.exit(1);
  }
  console.log(`\nAll emit/projection tests passed.`);
}

main();
