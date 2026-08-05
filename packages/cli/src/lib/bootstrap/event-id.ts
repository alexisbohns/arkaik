/**
 * Deterministic, sortable, collision-resistant event ids.
 *
 * `@arkaik/schema`'s `ulid()` mints a random component, which is right for
 * live writes and wrong here: bootstrap CONSTRUCTS history, and `merge`
 * re-run over unchanged fragments must produce a byte-identical journal — the
 * property that makes the whole method re-runnable and resumable (docs/
 * superpowers/plans/2026-08-04-bootstrap-method.md, Task 5). So the id here is
 * a pure function of `(ts, key)`: the same 10-char Crockford base32 time
 * prefix `@arkaik/schema`'s `ulid()` uses, followed by 16 characters derived
 * from `key` — deterministic where `ulid()`'s is random, but occupying the
 * same shape so a brownfield journal's real ULIDs and this module's synthetic
 * ids interleave and sort together without either side noticing the other.
 *
 * This is the load-bearing piece for reproducibility, so it was not trusted
 * on the strength of reading it — six things about the original reference
 * design (the plan's Task 5 code block, written from memory and never run)
 * were probed empirically. What follows is what the probes found and why the
 * design below looks the way it does; `tests/cli/bootstrap-event-id.test.js`
 * carries the measurements.
 *
 * 1. **Entropy.** The reference derived its whole 16-char tail from ONE
 *    32-bit `FNV-1a` hash of `key`, then repeatedly perturbed that single
 *    value to emit each symbol. Perturbing a value never adds information to
 *    it — the entire tail was a deterministic (in fact bijective-ish)
 *    function of 32 bits, so the REAL collision space was 2^32, not 32^16.
 *    Measured directly (see the test file): among 1,000,000 sequential
 *    synthetic keys sharing one `ts`, that design produced 8 real id
 *    collisions; using the self-map seed's own real max fan-out (15 events
 *    sharing a `ts`) the risk is negligible either way, but the fix costs
 *    nothing, so it's fixed rather than left as "probably fine at today's
 *    scale." Here, each of the 16 output symbols comes from its OWN
 *    independent hash of `key` (salted by its position), so the tail's real
 *    entropy scales with the number of independent symbols, not with the
 *    width of one accumulator.
 * 2. **The zero-state trap.** The reference's rolling accumulator did
 *    `h = mix(h) || 0x811c9dc5` — reachable (a 32-bit mixing step can land on
 *    exactly 0), and a genuine bug when it did: two different keys hitting
 *    the zero state at the same loop iteration would converge to an
 *    identical tail from that point on, because the substituted constant
 *    erases whatever made them different. There is no rolling accumulator
 *    here at all — each symbol is its own independent computation from
 *    scratch — so there is no absorbing state to guard against in the first
 *    place. (A hash landing on a multiple of 32 just selects symbol `'0'`;
 *    that's an ordinary output, not a degenerate one.)
 * 3. **FNV-1a's weak low-bit avalanche.** A first attempt at "16 independent
 *    hashes" (`fnv1a(`${i}:${key}`) % 32` per symbol) was tried and measured,
 *    not assumed: at 1,000,000 sequential synthetic keys it produced 616,688
 *    collisions (only 383,312 distinct suffixes survived) — between
 *    near-identical keys (e.g. keys differing only in a trailing sequence
 *    number), because FNV-1a's low bits mix poorly for short, similar
 *    inputs — a documented property of the algorithm, not a coding mistake.
 *    Running each per-symbol hash through Murmur3's `fmix32` finalizer
 *    before extracting bits fixed this: zero collisions among the
 *    same 1,000,000 keys afterward.
 * 4. **Unparseable/missing `ts`.** The reference did
 *    `Number.isNaN(ms) ? 0 : ms`, silently encoding epoch 0 — an id that
 *    sorts before every real event, with nothing anywhere recording that
 *    something was wrong. Given how many of this run's real defects were
 *    exactly this shape (silent wrongness beats a loud failure every time),
 *    `deterministicEventId` throws instead. A bootstrap run that reaches this
 *    function with an unparseable `ts` has a real bug upstream — in the
 *    fragment an agent wrote, or in how `merge` built the fallback — and that
 *    bug deserves to stop the run, not to mint a wrong id quietly.
 * 5. **Does it need to be a valid ULID?** `journal-events.ts`'s envelope is
 *    `id: z.string()` — no format requirement, and nothing in `journal.ts`
 *    checks id uniqueness either; `orderEvents` sorts on `ts` first and only
 *    tiebreaks on `id` as an opaque string. So the properties that actually
 *    matter are: determinism (same input, same output, always), sortability
 *    (time-ordering must agree with real ULIDs when timestamps differ), and
 *    collision resistance (see 1 and 3). The 26-char ULID shape is kept
 *    anyway — it's free, it matches what a brownfield journal's real ids
 *    already look like, and it's what `bootstrap merge`'s own determinism
 *    test asserts — but it is a courtesy, not the contract.
 * 6. **Key uniqueness is OUT OF SCOPE here, and NOT fixed by anything in this
 *    file.** `deterministicEventId(ts, key)` guarantees identical output for
 *    identical input, including when the CALLER hands it two semantically
 *    different events that happen to share a key — no amount of hash quality
 *    changes that. Task 6's reference `merge.ts` has real gaps of exactly
 *    this kind (documented in the plan's Task 6 section as of this task):
 *    an `idea.proposed`/`request.filed` event with no `node_id` collapses its
 *    key to `type::ts`, so every such event on the same day collides;
 *    `release.tagged`'s key omits `platform`; and multiple
 *    `node.status_changed` transitions for the same node on the same
 *    calendar day collide, which the wave-3 "status arcs" unit explicitly
 *    plans to emit (1-3 events per node). Fixing that is Task 6's job, not
 *    this file's — building a unique key is a different problem than hashing
 *    one.
 */

// Crockford base32 (no I, L, O, U) — the same alphabet @arkaik/schema's
// ulid() uses, so the two id families interleave correctly when sorted.
const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** 48 bits of ms timestamp, same width as @arkaik/schema's ulid(). */
export const TIME_LEN = 10;
/** 16 symbols — same width as ulid()'s random component; here, every bit comes from `key`, not chance. */
export const RANDOM_LEN = 16;

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** One FNV-1a pass over `input`. */
function fnv1a(input: string): number {
  let h = FNV_OFFSET;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME);
  }
  return h >>> 0;
}

/**
 * Murmur3's `fmix32` finalizer: a full-avalanche bit mixer, applied to fix
 * FNV-1a's known weak low-bit avalanche on short/near-identical inputs (see
 * point 3 above) rather than trusting FNV-1a's raw output bits directly.
 */
function fmix32(hIn: number): number {
  let h = hIn >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Encode a non-negative millisecond timestamp as `TIME_LEN` Crockford base32
 * characters, high bits first — the identical algorithm (same alphabet, same
 * length, same mod/divide loop) to @arkaik/schema's emit.ts `encodeTime`,
 * verified by direct comparison in tests/cli/bootstrap-event-id.test.js
 * against the real `ulid()`'s own output. This equivalence is what lets a
 * brownfield journal's real ULIDs and this module's synthetic ids sort
 * correctly together by time.
 *
 * Negative input (a pre-1970 `ts`) clamps to epoch 0 rather than indexing
 * `ENCODING` with a negative remainder — real ULIDs are never minted for
 * pre-1970 events, so this never diverges from `ulid()` in practice; it's a
 * defensive floor, not a compatibility requirement.
 */
export function encodeTime(ms: number): string {
  let remaining = Math.max(0, Math.floor(ms));
  let out = "";
  for (let i = 0; i < TIME_LEN; i += 1) {
    const digit = remaining % 32;
    out = ENCODING[digit] + out;
    remaining = (remaining - digit) / 32;
  }
  return out;
}

/**
 * The RANDOM_LEN-character suffix, derived entirely from `key`. Each symbol
 * is its own independent computation — `key` salted with its position, hashed
 * fresh, then run through `fmix32` — rather than one hash state repeatedly
 * perturbed. See points 1-3 above for why both of those choices matter.
 */
function keySuffix(key: string): string {
  let out = "";
  for (let i = 0; i < RANDOM_LEN; i += 1) {
    const h = fmix32(fnv1a(`${i}:${key}`));
    out += ENCODING[h % 32];
  }
  return out;
}

/**
 * A stable id for the event identified by `key` at `ts`: the same `(ts, key)`
 * pair always produces the same id, and different keys at the same `ts`
 * produce different ids (empirically verified at 1,000,000 keys sharing one
 * `ts` — roughly 66,700x the self-map seed's real same-`ts` fan-out of 15 —
 * see the test file). `ts` must be a
 * parseable timestamp (anything `Date.parse` accepts, which covers every ISO
 * 8601 form this codebase writes); an unparseable or missing `ts` throws
 * rather than silently encoding epoch 0 (point 4 above).
 *
 * `key` must uniquely identify the event being minted — that is the caller's
 * responsibility, not this function's (point 6 above). Two distinct events a
 * caller keys identically will get identical ids, by design: this function
 * cannot tell them apart, because it never sees anything about the event
 * except `key` itself.
 */
export function deterministicEventId(ts: string, key: string): string {
  const ms = Date.parse(ts);
  if (Number.isNaN(ms)) {
    throw new Error(`deterministicEventId: ts is not a parseable timestamp: ${JSON.stringify(ts)}`);
  }
  return encodeTime(ms) + keySuffix(key);
}
