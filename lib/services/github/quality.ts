import "server-only";

import { findingResolvedInput, isOpenFinding, makeEvent, type JournalEvent, type QualityFinding } from "@arkaik/schema";

import { query } from "@/lib/services/db";
import { appendJournalEvents } from "@/lib/services/graph/store";
import { closedIssues, mentionedFindings, parseIssueRef } from "@/lib/services/github/quality-parse";
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

export async function applyQualityResolutions(
  event: PullRequestEvent,
  options: { readState?: ReadProjectQualityState } = {},
): Promise<QualityResolutionOutcome[]> {
  const mentioned = mentionedFindings(event);
  const issues = closedIssues(event);
  // Read nothing when the PR claims nothing. The overwhelming majority of
  // merges are this case, and a database round trip per project to discover it
  // would be a cost paid on every delivery for the rare one.
  if (mentioned.length === 0 && issues.length === 0) return [{ status: "no_mentions" }];

  const issueKeys = new Set(issues.map((ref) => `${ref.repo}#${ref.number}`));
  const readState = options.readState ?? loadProjectQualityState;
  const outcomes: QualityResolutionOutcome[] = [];

  for (const state of await readState(event)) {
    const byId = new Map(state.findings.map((finding) => [finding.id, finding]));
    const matched = new Map<string, QualityFinding>();

    for (const id of mentioned) {
      const finding = byId.get(id);
      if (finding === undefined) {
        outcomes.push({ projectId: state.projectId, status: "unknown", findingId: id });
        continue;
      }
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

  // Two different silences, deliberately named apart. `no_mentions` is "the PR
  // claimed nothing" and is decided before any read; this is "the PR claimed
  // something, and no linked project holds a finding it names" — the shape a
  // hosted project with no `quality` section in its snapshot produces. Reusing
  // `no_mentions` here would deny the one fact we actually know.
  return outcomes.length > 0 ? outcomes : [{ status: "no_quality_data" }];
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
