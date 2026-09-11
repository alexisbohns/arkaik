import type { ProjectValidators } from "@/lib/services/graph/store";

/**
 * The read side of the hosted graph API's HTTP validators
 * (docs/spec/services.md § Hosted Graph Projects → Read contract).
 *
 * Pure and dependency-free on purpose — no `server-only`, no database — so
 * the fast CI job can pin these rules the way `restore.ts`'s If-Match rules
 * are pinned, and so the browser could share them if it ever had to.
 *
 * ── Why the read ETags are WEAK ─────────────────────────────────────────────
 * A read validator is a composite: the snapshot `version` plus, for the
 * routes whose body also depends on the journal, an event count. The write
 * routes keep their strong `"<version>"` ETags and compare `If-Match` with
 * strong semantics — `parseIfMatch` (mutations) and `classifyIfMatch`
 * (restore) both refuse a `W/` prefix. Marking the read validators weak is
 * what makes echoing one into `If-Match` fail LOUDLY (400/409) instead of
 * silently applying a write against a version the client never actually
 * read. `If-None-Match`, by contrast, always compares weakly (RFC 9110
 * § 8.8.3.2), so a weak tag costs a conditional GET nothing.
 *
 * ── Why a COUNT, not `max(seq)` ─────────────────────────────────────────────
 * `appendJournalEvents` inserts without a transaction, so two concurrent
 * appends can commit out of `seq` order; a `max(seq)` validator taken between
 * the two commits would miss the earlier row for good. A count changes on
 * every committed insert regardless of order, and the one deleter (restore)
 * always bumps `version`, so the pair stays unique. It also keeps the
 * platform-wide `bigserial` out of a tenant-visible header.
 */

/** `W/"a.b"` from its parts — every part a string, never a `Number()`ed bigint. */
export function formatReadEtag(parts: readonly string[]): string {
  return `W/"${parts.join(".")}"`;
}

/**
 * `/nodes` and `/edges`: the version alone. Every snapshot writer bumps it,
 * and nothing else changes those two arrays.
 */
export function snapshotEtag(validators: ProjectValidators): string {
  return formatReadEtag([validators.version]);
}

/**
 * `/journal` and `/export`: version plus the whole event count, because a
 * journal-only append (a merged PR's `deliverable.shipped`, a quality
 * decision) changes both bodies without touching the version.
 */
export function journalEtag(validators: ProjectValidators): string {
  return formatReadEtag([validators.version, validators.eventCount]);
}

/**
 * `GET /projects/{id}`, the folded bundle: version plus the COUNT OF QUALITY
 * DECISIONS only. The fold reads nothing else from the journal, so a merged
 * PR's `deliverable.shipped` append must not turn the next map revalidation
 * into a multi-megabyte 200 — it does not change this body.
 */
export function bundleEtag(validators: ProjectValidators): string {
  return formatReadEtag([validators.version, validators.qualityEventCount]);
}

/**
 * The headers every read answer carries, 200 and 304 alike. `private`
 * because every body is owner-scoped (and it keeps a shared edge cache out),
 * `no-cache` because the browser must revalidate rather than reuse — the
 * client sends `If-None-Match` itself from the validator it stored — and
 * `Vary: Authorization` because a bearer token selects the owner.
 */
export function readResponseHeaders(etag: string): Record<string, string> {
  return { ETag: etag, "Cache-Control": "private, no-cache", Vary: "Authorization" };
}

/**
 * The opaque tag of an entity-tag, `W/` prefix stripped: what a weak
 * comparison looks at. Anything that is not a quoted tag comes back as-is,
 * so a malformed member simply fails to match.
 */
function opaqueTag(value: string): string {
  const trimmed = value.trim();
  return trimmed.replace(/^w\//i, "");
}

/**
 * Whether an `If-None-Match` header is satisfied by the representation's
 * current `etag` — i.e. whether a 304 is the right answer.
 *
 * Weak comparison, per RFC 9110 § 8.8.3.2: a case-insensitive `W/` on either
 * side is ignored and the quoted opaque tags are compared. `*` matches any
 * current representation, a comma list matches if any member does, and a
 * missing header never matches — the caller then sends the full body.
 */
export function ifNoneMatchSatisfied(header: string | null, etag: string): boolean {
  if (header === null) return false;
  const trimmed = header.trim();
  if (trimmed.length === 0) return false;
  if (trimmed === "*") return true;
  const wanted = opaqueTag(etag);
  return trimmed
    .split(",")
    .map(opaqueTag)
    .some((candidate) => candidate.length > 0 && candidate === wanted);
}

// `parseJournalTypes` — the `?types=` projection's parser — arrives with the
// journal projection (Part 2c) and lives here beside the validators it
// shares a route with.
