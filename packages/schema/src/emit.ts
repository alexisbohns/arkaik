/**
 * Write primitives — event id generation and construction (docs/spec/journal.md
 * § Event Envelope). These are the shared, browser-safe half of the journal
 * *write* path: `arkaik log` / `arkaik release` (and later `arkaik sync`) reuse
 * them, and so could app-side emission. The **filesystem** append lives in the
 * CLI instead, so this module — and everything that imports @arkaik/schema —
 * stays browser-safe.
 *
 * {@link ulid} is a hand-rolled, dependency-free ULID generator (48-bit ms
 * timestamp + 80-bit randomness, Crockford base32, 26 chars). It is
 * *monotonic*: two ids minted in the same millisecond still sort in creation
 * order (the random component is incremented rather than re-rolled), so a burst
 * of events written back-to-back keeps a stable, sortable order — the property
 * {@link orderEvents} tiebreaks on. Randomness comes from the Web Crypto global
 * (`globalThis.crypto`), present in Node 20 and the browser alike.
 */

import { JOURNAL_EVENT_SCHEMAS, JournalEventSchema } from "./journal-events";
import type { JournalEvent } from "./journal";

// Crockford base32 (no I, L, O, U) — the ULID alphabet.
const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ENCODING_LEN = ENCODING.length; // 32
const TIME_LEN = 10; // 48 bits of ms timestamp
const RANDOM_LEN = 16; // 80 bits of randomness

/** Encode a millisecond timestamp as `len` Crockford base32 chars, high bits first. */
function encodeTime(time: number, len: number): string {
  let out = "";
  let t = time;
  for (let i = len - 1; i >= 0; i -= 1) {
    const mod = t % ENCODING_LEN;
    out = ENCODING[mod] + out;
    t = (t - mod) / ENCODING_LEN;
  }
  return out;
}

/** `len` fresh random symbols, each a uniform value in [0, 32). */
function randomSymbols(len: number): number[] {
  const bytes = new Uint8Array(len);
  globalThis.crypto.getRandomValues(bytes);
  // `& 31` is uniform: 256 is a multiple of 32, so the low 5 bits are unbiased.
  return Array.from(bytes, (b) => b & 31);
}

/**
 * The next random component after `symbols`, treating it as a big-endian base32
 * number and adding one (with carry). On the astronomically unlikely overflow
 * (all symbols already 31) a fresh random component is drawn instead.
 */
function incrementSymbols(symbols: number[]): number[] {
  const out = symbols.slice();
  for (let i = out.length - 1; i >= 0; i -= 1) {
    if (out[i] < ENCODING_LEN - 1) {
      out[i] += 1;
      return out;
    }
    out[i] = 0;
  }
  return randomSymbols(RANDOM_LEN);
}

// Monotonic state: the last timestamp/random pair we minted from.
let lastTime = -1;
let lastRandom: number[] = [];

/**
 * A ULID string (docs/spec/journal.md § Event Envelope). Monotonic across calls
 * — ids minted in the same millisecond increment the random component so they
 * stay strictly increasing; a later millisecond always sorts after an earlier
 * one because the timestamp is the high-order part. `seedTime` (defaulting to
 * `Date.now()`) is exposed for deterministic tests; a `seedTime` at or before
 * the last one still yields a strictly greater id.
 */
export function ulid(seedTime: number = Date.now()): string {
  if (seedTime > lastTime) {
    lastTime = seedTime;
    lastRandom = randomSymbols(RANDOM_LEN);
  } else {
    lastRandom = incrementSymbols(lastRandom);
  }
  return encodeTime(lastTime, TIME_LEN) + lastRandom.map((s) => ENCODING[s]).join("");
}

/** Options for {@link makeEvent}: the envelope fields a caller supplies. */
export interface MakeEventOptions {
  /** Who/what wrote it (e.g. "arkaik-cli", "claude-code"). Omitted → no `actor`. */
  actor?: string;
  /** Event time; a `Date` or ISO 8601 string. Defaults to now. */
  ts?: string | Date;
  /** Explicit id override, for deterministic tests. Defaults to a fresh {@link ulid}. */
  id?: string;
}

/**
 * Construct a journal event: stamp the envelope (`id` ULID, `ts` ISO 8601,
 * optional `actor`, `type`) onto `payload`, then validate against the matching
 * event schema (falling back to the lenient {@link JournalEventSchema} for an
 * unknown `type`). Returns the validated event; throws (zod) on an invalid
 * payload — a bad enum, a missing required field — so writers never append a
 * malformed line. `payload` MUST NOT carry envelope keys; the envelope wins.
 */
export function makeEvent(
  type: string,
  payload: Record<string, unknown> = {},
  options: MakeEventOptions = {},
): JournalEvent {
  const ts = options.ts instanceof Date ? options.ts.toISOString() : options.ts ?? new Date().toISOString();
  const id = options.id ?? ulid();

  const event: Record<string, unknown> = {
    id,
    ts,
    ...(options.actor !== undefined ? { actor: options.actor } : {}),
    type,
    ...payload,
  };

  const schema = JOURNAL_EVENT_SCHEMAS[type as keyof typeof JOURNAL_EVENT_SCHEMAS] ?? JournalEventSchema;
  return schema.parse(event) as JournalEvent;
}
