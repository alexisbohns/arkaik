import type { ProjectSummary } from "./data-provider";

/**
 * The three groups the projects page shows.
 *
 * Note there are only TWO storage backends behind these: hosted (the account)
 * and local (this browser). "Synked" is a *state* of a local project — it has a
 * Synk backup on the server — not a third place data can live. That is the
 * whole local-first promise: signing in and backing up adds a copy, it never
 * moves your data.
 */
export type ProjectSection = "hosted" | "synked" | "lokal";

/**
 * Which section a project belongs to.
 *
 * Takes the set of backed-up project ids as an argument rather than fetching
 * it, so this stays a pure function of its inputs — testable in Node with no
 * DOM, no Dexie and no network. The caller (`app/projects/page.tsx`) owns the
 * single `/api/synk/projects` fetch that produces the set.
 *
 * Signed out, the caller passes an empty set and every local project is Lokal,
 * which is exactly right: without an account there are no backups to have.
 */
export function sectionFor(summary: ProjectSummary, backedUpIds: Set<string>): ProjectSection {
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
