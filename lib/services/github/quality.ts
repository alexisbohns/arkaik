import "server-only";

import { findingResolvedInput, isOpenFinding, makeEvent, type JournalEvent, type QualityFinding } from "@arkaik/schema";

import { query } from "@/lib/services/db";
import { appendJournalEvents } from "@/lib/services/graph/store";
import { closedIssues, parseIssueRef, scanFindings } from "@/lib/services/github/quality-parse";
import { linkedProjects, ownerIdsFor, type PullRequestEvent } from "@/lib/services/github/pull-request";

/**
 * The Kritik half of a merged-PR delivery (issue #382 phase E, RFC § 3.4).
 *
 * The third half beside acceptance promotion and the Lab Note, and independent
 * of both by the same design: a finding that cannot be matched never blocks a
 * status transition or a note, and vice versa. Problems are OUTCOMES; only
 * infrastructure failures throw, so the webhook's claim-release/retry covers
 * them — and the already-resolved check below makes that retry safe.
 *
 * **This appends, and appends only.** The finding's stored `status` stays as
 * the last audit left it; `foldFindingEvents` (lib/utils/quality.ts) is what
 * makes the resolution visible on every read. RFC § 3.2 said so first: current
 * state is a projection, latest audit plus open-minus-resolved.
 */
export type QualityResolutionOutcome =
  | { projectId: string; status: "resolved"; findingId: string; eventId: string }
  | { projectId: string; status: "unchanged"; findingId: string }
  | { projectId: string; status: "unknown"; findingId: string }
  | { projectId: string; status: "refused"; findingId: string }
  /**
   * The finding was NAMED, with no closing verb, and is still open (issue
   * #440). Nothing was written. Reported rather than swallowed because the
   * delivery response is the one diagnostic surface docs/hosted-projects.md
   * points people at, and a grammar change that produced a new silence would
   * be this round's defect at one remove.
   */
  | { projectId: string; status: "mentioned"; findingId: string; hint: string }
  /**
   * A linked project DOES hold a finding this pull request names, and there
   * was nothing to do about it — every one was already resolved, accepted or
   * refuted. Distinct from `no_quality_data` below, which denies that any
   * project holds what the PR named: saying that about a project whose
   * findings we had just read would deny a fact this pass knows.
   */
  | { status: "nothing_to_do" }
  | { status: "no_quality_data" }
  | { status: "no_mentions" };

/** One project's quality state, and the way to write back to it. */
export interface ProjectQualityState {
  projectId: string;
  findings: QualityFinding[];
  /**
   * Findings a `quality.finding.resolved` OR `quality.finding.accepted`
   * event already names. A finding accepted via event still LOOKS open in
   * the unfolded snapshot this state is read from (the fold that would show
   * otherwise is a read projection, not this write path's business — see the
   * comment on `loadProjectQualityState` below) — so without this set, a
   * merge that mentions it would silently reopen-then-reclose a decision
   * somebody already recorded.
   */
  decidedFindingIds: Set<string>;
  append: (events: JournalEvent[]) => Promise<string[]>;
}

/**
 * The one seam this module has. Injected by the suite for the same reason
 * `applyPullRequestEvent` injects `fetchFiles`: the whole pass is then pinned
 * without a database, which is what keeps it in CI's fast job.
 */
export type ReadProjectQualityState = (event: PullRequestEvent) => Promise<ProjectQualityState[]>;

/**
 * What a `mentioned` outcome tells the author to do instead.
 *
 * IT DOES NOT DIAGNOSE, because it cannot. Three different bodies land here
 * and only one of them forgot a verb: a bare id did, a `Closes` wrapped onto
 * the line above its id did not, and a `Closes F-…` in the TITLE did not
 * either. The first wording said "named without a closing verb", which told
 * two of those three authors they had omitted something they had in fact
 * written — and pointed them back at the text that was already there.
 *
 * So it states the outcome ("named but not closed") and then the shape that
 * works, which is true advice for all three: in the body, on one line, with
 * nothing but spaces or a colon between the verb and the id. That last clause
 * also covers `**Closes** F-…` and `Closes [F-…](url)`, which break the pair
 * the same way and would otherwise be a fourth silent case.
 */
const mentionHint = (findingId: string) =>
  `named but not closed — write \`Closes ${findingId}\` in the PR body, ` +
  `verb and id on one line with nothing but spaces or a colon between them`;

export async function applyQualityResolutions(
  event: PullRequestEvent,
  options: { readState?: ReadProjectQualityState } = {},
): Promise<QualityResolutionOutcome[]> {
  const scan = scanFindings(event);
  const issues = closedIssues(event);
  // Read nothing when the PR claims nothing. The overwhelming majority of
  // merges are this case, and a database round trip per project to discover it
  // would be a cost paid on every delivery for the rare one.
  //
  // A BARE MENTION COUNTS AS A CLAIM here, even though it resolves nothing:
  // deciding whether to report it needs the finding — does this project hold
  // it, is it still open — and only the read has that. This costs no more
  // deliveries than before, either: `mentionedFindings` scanned the same two
  // texts for the same tokens, and `closed` ∪ `mentioned` is exactly the set
  // it returned. What changed is what happens after the read, not how often
  // one happens.
  if (scan.closed.length === 0 && scan.mentioned.length === 0 && issues.length === 0) {
    return [{ status: "no_mentions" }];
  }

  const issueKeys = new Set(issues.map((ref) => `${ref.repo}#${ref.number}`));
  const readState = options.readState ?? loadProjectQualityState;
  const outcomes: QualityResolutionOutcome[] = [];
  // Whether ANY linked project turned out to hold a finding this PR named —
  // the one fact that separates the two silences below, and knowable only
  // after the reads.
  let anyKnown = false;

  for (const state of await readState(event)) {
    const byId = new Map(state.findings.map((finding) => [finding.id, finding]));
    const matched = new Map<string, QualityFinding>();

    for (const id of scan.closed) {
      const finding = byId.get(id);
      if (finding === undefined) {
        outcomes.push({ projectId: state.projectId, status: "unknown", findingId: id });
        continue;
      }
      anyKnown = true;
      matched.set(finding.id, finding);
    }
    for (const finding of state.findings) {
      // No `typeof` guard: `parseIssueRef` takes `string | null | undefined`
      // precisely so a finding with no `issue_url` needs no ceremony here.
      const ref = parseIssueRef(finding.issue_url);
      if (ref !== undefined && issueKeys.has(`${ref.repo}#${ref.number}`)) matched.set(finding.id, finding);
    }

    const events: JournalEvent[] = [];
    const resolving: string[] = [];
    for (const finding of matched.values()) {
      // `refuted` and `accepted-risk` are decisions somebody recorded, not
      // defects waiting to be closed, and `resolved` is already done. Only an
      // open finding can be closed by a merge.
      if (!isOpenFinding(finding) || state.decidedFindingIds.has(finding.id)) {
        outcomes.push({ projectId: state.projectId, status: "unchanged", findingId: finding.id });
        continue;
      }
      const input = findingResolvedInput(finding, event.url);
      events.push(makeEvent(input.type, input.payload, { actor: "github-app" }));
      resolving.push(finding.id);
    }

    // ABOVE the `events.length === 0` bail below, and that is the constraint
    // that pins it: a project whose PR closes nothing — the pure-mention case
    // this outcome exists for — never reaches the lines past that bail, and
    // neither does one whose append is refused. Both would silently report no
    // mentions at all. (It also has to follow the two loops above, so
    // `matched` is complete and a finding reached through its own issue is
    // not reported as a loose end as well.)
    for (const id of scan.mentioned) {
      const finding = byId.get(id);
      // Unlike the `closed` channel above, an id nothing answers to is NOT
      // reported. There the author asserted a closure and it failed, which is
      // actionable; here it is prose that happened to look id-shaped, and
      // reporting it would make every PR discussing findings noisy.
      if (finding === undefined || matched.has(finding.id)) continue;
      anyKnown = true;
      // Nor is a finding somebody already decided: it is not outstanding, so
      // there is nothing the author could do about it.
      if (!isOpenFinding(finding) || state.decidedFindingIds.has(finding.id)) continue;
      outcomes.push({
        projectId: state.projectId,
        status: "mentioned",
        findingId: finding.id,
        hint: mentionHint(finding.id),
      });
    }

    if (events.length === 0) continue;
    const eventIds = await state.append(events);
    // An append that wrote nothing is a REFUSAL, not a resolution. Reporting it
    // as `resolved` would tell the one diagnostic surface anybody reads — the
    // delivery response docs/hosted-projects.md points people at — that a
    // finding was closed when the journal never took it.
    if (eventIds.length === 0) {
      for (const findingId of resolving) {
        outcomes.push({ projectId: state.projectId, status: "refused", findingId });
      }
      continue;
    }
    resolving.forEach((findingId, index) => {
      outcomes.push({ projectId: state.projectId, status: "resolved", findingId, eventId: eventIds[index] });
    });
  }

  // THREE silences, and they are not interchangeable. `no_mentions` is "the PR
  // claimed nothing" and is decided before any read. `nothing_to_do` is "a
  // project holds what it named, and every one was already decided". And this
  // last one is "the PR claimed something, and no linked project holds a
  // finding it names" — the shape a hosted project with no `quality` section
  // in its snapshot produces. Collapsing any pair of them would have the one
  // diagnostic surface anybody reads deny something this pass knows.
  if (outcomes.length > 0) return outcomes;
  return [{ status: anyKnown ? "nothing_to_do" : "no_quality_data" }];
}

/**
 * The production seam: one state per linked PROJECT, deduped the way
 * `applyLabNote` dedupes — a monorepo's several path-scoped links to one
 * repository still produce exactly one pass, because a finding is project-level
 * and path scoping gates promotions, not quality.
 *
 * The snapshot is read UNFOLDED on purpose. `store.getProject` returns what
 * Postgres holds, which is what this pass must compare against; the fold is a
 * read projection for the app and has no business in a write path.
 */
const loadProjectQualityState: ReadProjectQualityState = async (event) => {
  const projectIds = [...new Set((await linkedProjects(event.repoFullName)).map((row) => row.projectId))];
  const states: ProjectQualityState[] = [];

  for (const projectId of projectIds) {
    const { rows: snapshots } = await query<{ findings: QualityFinding[] | null }>(
      `select snapshot->'quality'->'findings' as findings from graph_projects where id = $1 and archived_at is null`,
      [projectId],
    );
    const findings = Array.isArray(snapshots[0]?.findings) ? snapshots[0].findings : [];
    if (findings.length === 0) continue;

    const { rows: decided } = await query<{ finding_id: string }>(
      `select event->>'finding_id' as finding_id from graph_events
        where project_id = $1
          and event->>'type' in ('quality.finding.resolved', 'quality.finding.accepted')`,
      [projectId],
    );

    states.push({
      projectId,
      findings,
      decidedFindingIds: new Set(decided.map((row) => row.finding_id).filter((id): id is string => typeof id === "string")),
      append: async (events) => {
        const ownerIds = await ownerIdsFor(projectId);
        const result = await appendJournalEvents(projectId, ownerIds, events, "github-app");
        if (!result.ok) {
          console.warn(`[quality] ${projectId}: append refused (${result.reason})`);
          return [];
        }
        return events.map((journalEvent) => journalEvent.id);
      },
    });
  }

  return states;
};
