/**
 * The journal algebra: event key construction, order-sensitivity, and the
 * de-duplicating merge of a base journal with freshly-derived events.
 *
 * Extracted out of `merge.ts` (coordinator review, round 3) for the same
 * reason `era-window.ts` and `body-budget.ts` were extracted from `slice.ts`
 * (Task 4): this is where most of round 3's fixes landed, it's the newest
 * code in the whole bootstrap surface, and until this extraction it had zero
 * direct tests — every behavior here was reachable only through a full
 * CLI-spawn-plus-fixture round trip. `canonicalJson({a: undefined}) !==
 * canonicalJson({})` is a two-line direct test; through the CLI it took a
 * four-step fixture with a hand-edited bundle.
 *
 * Zero imports, by design, so it can be `require()`d directly in a test
 * (Node's native TypeScript support strips types at load time) with no CLI
 * build needed — see `tests/cli/bootstrap-journal-merge.test.js`.
 *
 * The full defect-by-defect history of how this module got this shape (what
 * broke, how it was reproduced, why each fix looks the way it does) lives in
 * docs/superpowers/plans/2026-08-04-bootstrap-method.md, Task 6 — this file's
 * comments explain what the code does and why; that document explains how it
 * got here.
 */

export type AnyRecord = Record<string, unknown>;

/** Sort events by ts, then id — the same total order `@arkaik/schema`'s `orderEvents` gives. */
export function sortEvents(events: AnyRecord[]): AnyRecord[] {
  return [...events].sort((a, b) => {
    const at = String(a.ts ?? "");
    const bt = String(b.ts ?? "");
    if (at !== bt) return at < bt ? -1 : 1;
    const ai = String(a.id ?? "");
    const bi = String(b.id ?? "");
    return ai < bi ? -1 : ai > bi ? 1 : 0;
  });
}

/**
 * Key-order-independent JSON serialization, for comparing two event objects
 * by VALUE rather than by their accidental property insertion order (a base
 * event read back from disk and a freshly-constructed one can differ only in
 * key order and still be "the same event"). Used by {@link mergeJournal} to
 * tell a genuine payload divergence apart from a harmless re-run.
 *
 * Deliberately matches `JSON.stringify`'s own handling of `undefined`
 * exactly, in both directions it appears:
 *  - An object key whose value is `undefined` is OMITTED (`JSON.stringify`
 *    drops it too) — the first version of this function instead emitted the
 *    literal token `undefined` for such a key, which meant a freshly-minted
 *    event (built with `{ ..., platform: someOptionalValue }` where the
 *    value happened to be `undefined`) could never compare equal to its own
 *    `JSON.stringify` round-trip (which simply lacks the key). Every
 *    "divergence" this produced was two byte-identical payloads presented as
 *    a conflict — unactionable, and wrong.
 *  - An `undefined` ARRAY element renders as `null` (`JSON.stringify`'s own
 *    array-hole behavior), reached when `canonicalJson` recurses into an
 *    array containing one.
 */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const obj = value as AnyRecord;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Whether `ev` participates in `crossCheckJournal`'s "last transition wins"
 * comparison against the snapshot — the only place where the READ-BACK ORDER
 * of two same-node events (not just their presence) actually matters:
 * `node.status_changed` (when not platform-scoped — a platform-scoped one
 * moves a per-platform view status, which nothing in `crossCheckJournal`
 * cross-checks against the snapshot today) and `decision.status_changed`
 * (always — decisions have no platform axis).
 */
export function isOrderSensitive(ev: AnyRecord): boolean {
  if (ev.type === "decision.status_changed") return true;
  if (ev.type === "node.status_changed") return ev.platform === undefined;
  return false;
}

/**
 * A key that actually distinguishes two events sharing a `type` and `ts`.
 * Every field below is folded in WHEN PRESENT on `raw`; two events differing
 * in any of them get different keys, and thus (via `deterministicEventId`)
 * different ids. `ts` is included explicitly even though
 * `deterministicEventId` already encodes it into the id's time prefix —
 * redundant, but harmless, and keeps the key self-describing on its own.
 *
 * Non-string field values route through {@link canonicalJson} (round 3) —
 * folded in from a separate, simpler `stringify` helper that used raw
 * `JSON.stringify` instead. That mattered because some envelope fields this
 * key reads (`NodeUpdatedEvent.from`/`.to` are typed `unknown`) can legally
 * be objects, and raw `JSON.stringify` is key-order DEPENDENT — two
 * equivalent objects differing only in property order would have produced
 * different keys, and thus different ids, for "the same" event. Changing
 * this changes every id `deterministicEventId` derives from it, for any
 * event whose key happens to include a non-string field — done now,
 * deliberately, before any real journal exists from this code, so it never
 * has to be done later against committed history.
 */
export function eventKey(raw: AnyRecord, ts: string): string {
  const stringify = (value: unknown): string => (typeof value === "string" ? value : canonicalJson(value));
  const type = String(raw.type ?? "");
  const parts = [type, `ts=${ts}`];
  const field = (label: string, value: unknown): void => {
    if (value !== undefined) parts.push(`${label}=${stringify(value)}`);
  };
  field("node", raw.node_id);
  field("deliverable", raw.deliverable_id);
  field("version", raw.version);
  field("edge", raw.edge_id);
  field("ref", raw.ref_id);
  field("source", raw.source_id);
  field("target", raw.target_id);
  field("platform", raw.platform);
  field("from", raw.from);
  field("to", raw.to);
  field("title", raw.title);
  field("url", raw.url);
  return parts.join("|");
}

export interface JournalConflict {
  id: string;
  base: AnyRecord;
  fresh: AnyRecord;
}

/**
 * Merge `base` (the journal already on disk / embedded in the base bundle)
 * with `fresh` (this run's newly-derived events), de-duplicating by `id`.
 *
 * The whole point of `deterministicEventId` is that the SAME logical event
 * gets the SAME id on every run — which means a naive concat-then-sort
 * doubles the journal every time `merge` re-runs over unchanged story
 * fragments. `base`'s copy always wins on an id collision (it's the one
 * already committed — the append-only-journal invariant, and "fresh wins"
 * would let a re-run silently clobber a deliberate, out-of-band edit to
 * committed history, which is worse); `added` counts only ids that were not
 * already present, so callers can report what genuinely changed, not what
 * got re-derived and thrown away.
 *
 * `conflicts` names every id where the fresh payload actually DIFFERS from
 * what's committed — base still wins, nothing is silently overwritten, but
 * the caller can turn each one into a hard failure rather than letting a
 * real divergence disappear as an indistinguishable "+0 events". Compared
 * via {@link canonicalJson} so two representations of the same value
 * (different key order, or an explicit `undefined` vs an absent key) don't
 * false-positive.
 */
export function mergeJournal(
  base: readonly AnyRecord[],
  fresh: readonly AnyRecord[],
): { journal: AnyRecord[]; added: number; conflicts: JournalConflict[] } {
  const byId = new Map<string, AnyRecord>();
  for (const ev of base) {
    const id = typeof ev.id === "string" ? ev.id : undefined;
    if (id) byId.set(id, ev);
  }
  let added = 0;
  const conflicts: JournalConflict[] = [];
  for (const ev of fresh) {
    const id = typeof ev.id === "string" ? ev.id : undefined;
    if (!id) continue;
    const existing = byId.get(id);
    if (existing) {
      if (canonicalJson(existing) !== canonicalJson(ev)) {
        conflicts.push({ id, base: existing, fresh: ev });
      }
      continue;
    }
    byId.set(id, ev);
    added += 1;
  }
  return { journal: sortEvents([...byId.values()]), added, conflicts };
}
