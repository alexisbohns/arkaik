/**
 * Journal read-path projections for the app.
 *
 * These are re-exported from `@arkaik/schema` — the single source of truth for
 * the projection rules (node timeline, changelog, backlog) so the app and the
 * CLI (`arkaik log` / `arkaik release`) can never drift. Re-exporting here,
 * rather than declaring the functions a second time, mirrors how
 * `lib/data/types.ts` re-exports the bundle shapes. See
 * `docs/spec/toolchain.md` § @arkaik/schema and `docs/spec/journal.md`
 * § Projections.
 *
 * The existing importers of `@/lib/utils/journal` are unaffected: every name
 * they consumed (`computeNodeTimeline`, `computeChangelog`, `computeBacklog`,
 * and the `Changelog` / `Backlog` result types) is still exported from here.
 */

export { computeNodeTimeline, computeChangelog, computeBacklog } from "@arkaik/schema";

export type {
  NodeTimeline,
  Changelog,
  ChangelogOptions,
  Backlog,
  BacklogOptions,
} from "@arkaik/schema";
