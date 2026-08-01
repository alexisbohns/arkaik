import type { ProjectSummary } from "./data-provider";
import type { CreateTarget } from "./create-target";

/**
 * Which section a project belongs to.
 *
 * The three sections are named by `CreateTarget` rather than a type of their
 * own: "where a project is" and "where a new one is going" are the same three
 * names, and a second identical union would only invite the two to drift.
 *
 * Note there are only TWO storage backends behind those three names: hosted
 * (the account) and local (this browser). "Synked" is a *state* of a local
 * project — it has a Synk backup on the server — not a third place data can
 * live. That is the whole local-first promise: signing in and backing up adds a
 * copy, it never moves your data.
 *
 * Takes the set of backed-up project ids as an argument rather than fetching
 * it, so this stays a pure function of its inputs — testable in Node with no
 * DOM, no Dexie and no network. The caller (`app/projects/page.tsx`) owns the
 * single `/api/synk/projects` fetch that produces the set.
 *
 * Signed out, the caller passes an empty set and every local project is Lokal,
 * which is exactly right: without an account there are no backups to have.
 */
export function sectionFor(summary: ProjectSummary, backedUpIds: Set<string>): CreateTarget {
  if (summary.hosted) return "hosted";
  return backedUpIds.has(summary.project.id) ? "synked" : "lokal";
}

/** A project list split into the three sections, input order preserved within each. */
export interface GroupedProjects {
  hosted: ProjectSummary[];
  synked: ProjectSummary[];
  lokal: ProjectSummary[];
}

/** Split a project list into its three sections in one pass. */
export function groupBySection(
  summaries: ProjectSummary[],
  backedUpIds: Set<string>
): GroupedProjects {
  const grouped: GroupedProjects = { hosted: [], synked: [], lokal: [] };
  for (const summary of summaries) {
    grouped[sectionFor(summary, backedUpIds)].push(summary);
  }
  return grouped;
}
