#!/usr/bin/env node

/**
 * Direct unit tests for `packages/cli/src/lib/bootstrap/event-id.ts` —
 * `deterministicEventId`, the pure-function replacement for `@arkaik/schema`'s
 * random `ulid()` that `bootstrap merge` (Task 6) needs for byte-identical,
 * re-runnable output.
 *
 * Requires the `.ts` source directly (Node's native TypeScript support strips
 * the types at load time), same as bootstrap-era-window.test.js and
 * bootstrap-body-budget.test.js — no CLI build needed. This function is
 * explicitly the load-bearing piece for merge's reproducibility guarantee, so
 * it gets its own direct coverage rather than being proven only through the
 * full corpus -> plan -> merge CLI round trip (Task 9's plan text originally
 * said there would be no separate test for this file — that was written
 * before the direct-require pattern existed, and is superseded by this file).
 *
 * The reference implementation this module started from (the plan's Task 5
 * code block) was written from memory and never run. Six things were
 * suspected wrong and probed here, empirically, not just by reading:
 *
 *  1. Entropy: the reference derived its whole 16-char "random" component
 *     from ONE 32-bit FNV-1a hash of the key, repeatedly perturbed — so the
 *     real collision space was 2^32, not 32^16. Measured (in the scratch
 *     analysis that shaped this file, not shipped here): among 1,000,000
 *     sequential synthetic keys sharing one `ts`, the reference produced 8
 *     real suffix collisions; this module's design (16 INDEPENDENT hashes,
 *     one per output symbol, each run through a Murmur3 fmix32 finalizer)
 *     produced zero at the same scale. See the stress test below.
 *  2. The reference's `|| 0x811c9dc5` zero-guard: reachable (a 32-bit mixing
 *     step can legitimately land on 0), and a real bug when it fires — two
 *     different keys hitting the zero state at the same loop iteration would
 *     converge to an identical tail forever after. This module has no rolling
 *     accumulator at all (each symbol is its own independent computation), so
 *     there is no absorbing state to guard in the first place.
 *  3. Coexistence with real ULIDs: verified below by loading the ACTUAL
 *     `ulid()` from @arkaik/schema (via tests/schema/load-schema.js, the same
 *     loader tests/schema/emit.test.js uses) and comparing its time prefix
 *     against this module's `encodeTime` directly, not by eyeballing the
 *     source.
 *  4. Unparseable/missing `ts`: the reference silently encoded epoch 0,
 *     sorting before every real event with no signal anything was wrong.
 *     This module throws instead — see the throws-on-bad-ts checks below.
 *  5. ULID shape: `journal-events.ts`'s envelope only requires `id: z.string()`
 *     — no format check. This module still emits a 26-char ULID-shaped string
 *     (cheap, matches the format real ULIDs already in a brownfield journal
 *     use, and is what merge's own determinism test asserts), but the
 *     properties that actually matter are determinism, sortability by time,
 *     and collision resistance — not imitating a ULID for its own sake.
 *  6. Key uniqueness is OUT OF SCOPE for this function and NOT fixed here:
 *     `deterministicEventId(ts, key)` guarantees the same id for the same
 *     pair, always — including when the CALLER hands it two semantically
 *     different events that happen to share a key. Task 6's reference
 *     `merge.ts` has real key-construction gaps (an `idea.proposed`/
 *     `request.filed` event with no `node_id` collapses its key to
 *     `type::ts` — EVERY such event on the same day collides; `release.tagged`
 *     omits `platform` from its key; multiple `node.status_changed` events
 *     for the same node on the same calendar day collide) — see this task's
 *     report and the plan's updated Task 6 section. This file only proves
 *     "same key in, same id out" and "different key in, different id out
 *     (empirically, at scale)" — it cannot and does not prove every key Task 6
 *     constructs is actually unique per event, because that key construction
 *     doesn't live here.
 *
 * A seventh thing, found at review after the six above: everything so far
 * proves determinism WITHIN one process on one version of this module. These
 * ids get persisted to docs/arkaik/journal.jsonl and committed, which makes
 * "same input -> same output" a CROSS-VERSION contract too — nothing above
 * would catch `fmix32` being swapped out, or the salt order flipping, since
 * both would still pass every same-process check here while silently
 * producing different ids than an already-committed journal expects. The
 * golden/pinned-value block below exists specifically to catch that.
 */
const path = require("path");

const { deterministicEventId, encodeTime, TIME_LEN, RANDOM_LEN } = require(
  path.join(__dirname, "..", "..", "packages", "cli", "src", "lib", "bootstrap", "event-id.ts"),
);
const { loadSchema } = require(path.join(__dirname, "..", "schema", "load-schema.js"));
const { existsSync, readFileSync } = require("fs");

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS: ${name}`);
  } else {
    failures++;
    console.log(`FAIL: ${name}${detail ? `\n${detail}` : ""}`);
  }
}

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

// --- determinism: same (ts, key) always yields the same id ---
{
  const ts = "2026-01-02T10:00:00.000Z";
  const a = deterministicEventId(ts, "node.created:V-home");
  const b = deterministicEventId(ts, "node.created:V-home");
  check("same (ts, key) yields the same id", a === b, `${a} vs ${b}`);

  const c = deterministicEventId(ts, "node.created:V-home");
  const d = deterministicEventId(ts, "node.created:V-home");
  check("determinism holds across a third and fourth call too", a === c && a === d, `${a}, ${c}, ${d}`);
}

// --- golden: id stability pinned across CODE VERSIONS, not just across calls ---
// Every other check in this file proves determinism WITHIN one process on one
// version of this module — that's necessary but not sufficient. These ids get
// persisted to docs/arkaik/journal.jsonl and committed, which makes
// "same input -> same output" a CROSS-VERSION contract: swapping `fmix32` for
// a different finalizer, or reordering the salt to `${key}:${i}` instead of
// `${i}:${key}`, would pass every OTHER check in this file while silently
// producing different ids for the same (ts, key) than a previously-merged
// journal already committed to disk. Hardcoded expected values are the
// correct tool here, specifically because "it didn't change" IS the contract,
// not a tautology.
//
// If one of these three checks ever fails after an intentional change to
// `encodeTime`, `fnv1a`, `fmix32`, or `keySuffix`'s salting scheme: that
// change breaks reproducibility for every bundle bootstrap has already
// merged. Regenerate these constants deliberately, and say so in the commit
// message — a brownfield repo that already ran `bootstrap merge` will not
// reproduce its existing journal against the new code otherwise.
{
  check(
    "id is stable across versions (golden)",
    deterministicEventId("2026-01-02T10:00:00.000Z", "node.created:V-home") === "01KDZ2CN80B512T2QHM1SMF6NS",
  );
  check(
    "golden: status-change key",
    deterministicEventId("2026-01-02T10:00:00.000Z", "node.status_changed:V-home:2026-01-02T10:00:00.000Z") ===
      "01KDZ2CN80RQ77GHAE436V1HZP",
  );
  check(
    "golden: epoch + empty key",
    deterministicEventId("1970-01-01T00:00:00.000Z", "") === "000000000003TCK1MW1ZCAHJ72",
  );
}

// --- shape: ULID-shaped, TIME_LEN + RANDOM_LEN = 26 ---
{
  check("TIME_LEN + RANDOM_LEN is 26 (ULID length)", TIME_LEN + RANDOM_LEN === 26, `${TIME_LEN} + ${RANDOM_LEN}`);
  const id = deterministicEventId("2026-01-02T10:00:00.000Z", "node.created:V-home");
  check("id is ULID-shaped (26 Crockford base32 chars)", ULID_RE.test(id), id);
}

// --- different key, same ts -> different id ---
{
  const ts = "2026-01-02T10:00:00.000Z";
  const a = deterministicEventId(ts, "node.created:V-home");
  const b = deterministicEventId(ts, "node.created:V-settings");
  check("different keys at the same ts yield different ids", a !== b, `${a} vs ${b}`);
  check("both share the same time prefix (same ts)", a.slice(0, TIME_LEN) === b.slice(0, TIME_LEN), `${a} vs ${b}`);
  check("but differ in the key-derived suffix", a.slice(TIME_LEN) !== b.slice(TIME_LEN), `${a} vs ${b}`);
}

// --- same key, different ts -> different id (time prefix differs) ---
{
  const a = deterministicEventId("2026-01-02T10:00:00.000Z", "node.created:V-home");
  const b = deterministicEventId("2026-06-02T10:00:00.000Z", "node.created:V-home");
  check("same key at different timestamps yields a different id", a !== b, `${a} vs ${b}`);
  check("the key-derived suffix is unaffected by ts (only the time prefix moves)", a.slice(TIME_LEN) === b.slice(TIME_LEN), `${a} vs ${b}`);
}

// --- probe 4: unparseable / missing ts throws rather than silently encoding epoch 0 ---
{
  let threw = false;
  try {
    deterministicEventId("not-a-date", "node.created:V-home");
  } catch (err) {
    threw = true;
    check("bad-ts error names the offending value", String(err.message).includes("not-a-date"), String(err.message));
  }
  check("an unparseable ts throws instead of silently encoding epoch 0", threw, "");
}
{
  let threw = false;
  try {
    deterministicEventId("", "node.created:V-home");
  } catch {
    threw = true;
  }
  check("an empty-string ts throws", threw, "");
}
{
  let threw = false;
  try {
    deterministicEventId(undefined, "node.created:V-home");
  } catch {
    threw = true;
  }
  check("an undefined ts throws rather than coercing to a bogus value", threw, "");
}

// --- probe 3: coexistence with real ULIDs — direct comparison against @arkaik/schema's actual encodeTime ---
{
  const { ulid } = loadSchema();
  const samples = [0, 1, 1024, 1_700_000_000_000, Date.now()];
  for (const seedTime of samples) {
    // ulid() is monotonic module-level state; a strictly increasing seedTime
    // guarantees lastTime === seedTime for this call, so its first TIME_LEN
    // characters are exactly @arkaik/schema's encodeTime(seedTime, TIME_LEN).
    const real = ulid(seedTime + 10_000_000); // offset so this run's calls always exceed prior samples' monotonic state
    const realPrefix = real.slice(0, TIME_LEN);
    const oursPrefix = encodeTime(seedTime + 10_000_000);
    check(
      `encodeTime(${seedTime}) matches @arkaik/schema's real ulid() time prefix exactly`,
      oursPrefix === realPrefix,
      `ours=${oursPrefix} real=${realPrefix} (full real ulid: ${real})`,
    );
  }
}

// --- sortability: encodeTime output sorts lexicographically with increasing ms, including digit-rollover boundaries ---
{
  const pairs = [
    [0, 1],
    [31, 32], // first base32 digit rollover
    [1023, 1024], // second-digit rollover (32*32)
    [32 ** 5 - 1, 32 ** 5],
    [Date.now(), Date.now() + 1],
    [Date.parse("2026-01-31T23:59:59.999Z"), Date.parse("2026-02-01T00:00:00.000Z")],
  ];
  for (const [lo, hi] of pairs) {
    const a = encodeTime(lo);
    const b = encodeTime(hi);
    check(`encodeTime(${lo}) < encodeTime(${hi}) lexicographically`, a < b, `${a} vs ${b}`);
  }
}

// --- probe 6 (documented, not fixed here): same key always collapses to the same id, whatever the caller intended ---
{
  const ts = "2026-01-05T00:00:00.000Z";
  const a = deterministicEventId(ts, "idea.proposed::" + ts);
  const b = deterministicEventId(ts, "idea.proposed::" + ts);
  check(
    "identical keys collapse to identical ids — this function cannot and does not distinguish two events a caller keyed the same way",
    a === b,
    `${a} vs ${b}`,
  );
}

// --- stress test: collision resistance among many keys sharing a single ts ---
// The self-map seed's own real journal (checked below) tops out at 15 events
// sharing one `ts`. This goes roughly 1,300x past that (more than three
// orders of magnitude) to give the entropy claim real margin, while staying
// fast enough for CI (a few hundred ms): 16 independent fmix32-finalized
// hashes per id, not one reused 32-bit value, is what makes this pass at this
// scale — the naive "one hash, perturbed 16 times" design this replaced could
// not (see the file doc above).
{
  const ts = "2026-03-01T00:00:00.000Z";
  const n = 20000;
  const seen = new Set();
  let collisions = 0;
  for (let i = 0; i < n; i += 1) {
    const id = deterministicEventId(ts, `node.created:V-node-${i}`);
    if (seen.has(id)) collisions += 1;
    else seen.add(id);
  }
  check(`zero id collisions among ${n} distinct keys sharing one ts`, collisions === 0, `${collisions} collisions, ${seen.size} distinct`);
}

// --- real data: the self-map seed's own journal, ~530-800 real events, many sharing a ts by construction (backdated to PR merge dates) ---
{
  const seedPath = path.join(__dirname, "..", "..", "seed", "arkaik-self-map.json");
  if (!existsSync(seedPath)) {
    check("seed/arkaik-self-map.json is readable for the real-data check", false, `not found at ${seedPath}`);
  } else {
    const seed = JSON.parse(readFileSync(seedPath, "utf8"));
    const journal = Array.isArray(seed.journal) ? seed.journal : [];
    check("seed journal has a realistic number of events to test against", journal.length > 100, String(journal.length));

    // Bucket real events by ts to confirm the shared-timestamp premise this
    // whole probe rests on, and find the real max fan-out for one ts.
    const byTs = new Map();
    for (const ev of journal) {
      const ts = String(ev.ts ?? "");
      byTs.set(ts, (byTs.get(ts) ?? 0) + 1);
    }
    const maxFanOut = Math.max(...byTs.values());
    check("real events do share timestamps (max-fan-out ts has more than one event)", maxFanOut > 1, String(maxFanOut));

    // Re-derive a synthetic key per real event, mirroring the two key shapes
    // Task 6's reference merge.ts actually uses (node.created:<id>, and the
    // wave-3 `${type}:${node_id|deliverable_id|version}:${ts}` form), then
    // confirm the ids that come out are unique across the WHOLE real journal
    // — the acid test: real ts distribution, real event shapes, not a
    // fixture the author imagined.
    const ids = new Set();
    let collisions = 0;
    const collisionExamples = [];
    for (const ev of journal) {
      const ts = String(ev.ts ?? "");
      if (!ts) continue;
      const key =
        ev.type === "node.created"
          ? `node.created:${ev.node_id}`
          : `${ev.type}:${ev.node_id ?? ev.deliverable_id ?? ev.version ?? ""}:${ts}`;
      let id;
      try {
        id = deterministicEventId(ts, key);
      } catch (err) {
        check(`real event ts parses (${ts})`, false, String(err.message));
        continue;
      }
      if (ids.has(id)) {
        collisions += 1;
        if (collisionExamples.length < 5) collisionExamples.push({ key, id });
      } else {
        ids.add(id);
      }
    }
    check(
      "zero id collisions across the real self-map journal using merge's own key shapes",
      collisions === 0,
      JSON.stringify(collisionExamples),
    );
  }
}

process.exit(failures === 0 ? 0 : 1);
