import "server-only";

import { query } from "@/lib/services/db";
import { normalizePathPrefix } from "@/lib/services/github/paths";

/**
 * Repository links (db/migrations/009_project_repos.sql, 010_repo_path_prefix.sql)
 * — the rows the GitHub webhook resolves a delivery against.
 *
 * Without a link, a webhook for a repo finds no projects and does nothing, so
 * this is the surface that makes PR-driven transitions reachable at all.
 *
 * A link is identified by (project, provider, repository, PATH PREFIX), so one
 * project can link one monorepo several times — `apps/ios` as iOS, `apps/webapp`
 * as web. The empty prefix is the whole repository and is what every link
 * written before path scoping existed already carries.
 *
 * Every function is owner-scoped through the project: a link can only be
 * created by someone who can already write the project, which is what gives the
 * webhook its authority to act later.
 */

/** GitHub's own constraint: owner and name, each a bounded slug. */
const REPO_PATTERN = /^[A-Za-z0-9._-]{1,100}\/[A-Za-z0-9._-]{1,100}$/;

const PLATFORMS = new Set(["web", "ios", "android"]);

export interface RepoLink {
  repoFullName: string;
  /** The platform this repository builds for, or null when it serves all. */
  platform: string | null;
  /**
   * The subtree of the repository this link covers, normalised, `""` for the
   * whole repository. Part of the link's IDENTITY, not a detail: two links to
   * one repository differ only by this.
   */
  pathPrefix: string;
  createdAt: string;
}

export type RepoLinkFailure =
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "invalid_repo" }
  | { ok: false; reason: "invalid_platform" }
  | { ok: false; reason: "invalid_path" };

/** Whether the caller's owners include this project. One place, used by all three. */
async function ownsProject(projectId: string, ownerIds: readonly string[]): Promise<boolean> {
  const { rows } = await query<{ id: string }>(
    `select id from graph_projects where id = $1 and owner_id = any($2::text[])`,
    [projectId, ownerIds],
  );
  return rows.length > 0;
}

export async function listRepoLinks(
  projectId: string,
  ownerIds: readonly string[],
): Promise<RepoLink[] | null> {
  if (!(await ownsProject(projectId, ownerIds))) return null;
  const { rows } = await query<RepoLinkRow>(
    `select repo_full_name, platform, path_prefix, created_at
       from project_repos
      where project_id = $1 and provider = 'github'
      order by repo_full_name, path_prefix`,
    [projectId],
  );
  return rows.map(toLink);
}

interface RepoLinkRow {
  repo_full_name: string;
  platform: string | null;
  path_prefix: string;
  created_at: Date;
}

const toLink = (row: RepoLinkRow): RepoLink => ({
  repoFullName: row.repo_full_name,
  platform: row.platform,
  pathPrefix: row.path_prefix,
  createdAt: row.created_at.toISOString(),
});

/**
 * Link a repository (optionally one subtree of it), or update the platform of
 * an existing link.
 *
 * The name is lowercased on write because GitHub treats repository names
 * case-insensitively and webhook payloads make no promise about which case they
 * deliver — a link stored as `Acme/App` would never match a delivery for
 * `acme/app`, and the failure would be silent. THE PATH IS NOT LOWERCASED, for
 * the opposite reason: git paths are case-sensitive (see
 * lib/services/github/paths.ts).
 *
 * The prefix is normalised BEFORE the insert, not after. The primary key is
 * (project, provider, repo, path_prefix), so `apps/ios` and `apps/ios/` would
 * otherwise become two rows for one directory — and "one row per prefix", which
 * both the dialog's list key and the matcher's tie-freedom assume, would be
 * false.
 */
export async function linkRepo(
  projectId: string,
  ownerIds: readonly string[],
  input: { repoFullName: string; platform?: string | null; pathPrefix?: string | null },
): Promise<{ ok: true; link: RepoLink } | RepoLinkFailure> {
  if (!(await ownsProject(projectId, ownerIds))) return { ok: false, reason: "not_found" };

  const repoFullName = input.repoFullName.trim().toLowerCase();
  if (!REPO_PATTERN.test(repoFullName)) return { ok: false, reason: "invalid_repo" };

  const platform = input.platform ?? null;
  if (platform !== null && !PLATFORMS.has(platform)) return { ok: false, reason: "invalid_platform" };

  // `null` from the normaliser means the input cannot be made into a prefix at
  // all — today, a `..` segment. Refused here so the matcher can never be handed
  // one, and so the caller gets a 400 rather than the check constraint's 500.
  const pathPrefix = normalizePathPrefix(input.pathPrefix ?? "");
  if (pathPrefix === null) return { ok: false, reason: "invalid_path" };

  const { rows } = await query<RepoLinkRow>(
    `insert into project_repos (project_id, provider, repo_full_name, platform, path_prefix)
     values ($1, 'github', $2, $3, $4)
     on conflict (project_id, provider, repo_full_name, path_prefix)
       do update set platform = excluded.platform
     returning repo_full_name, platform, path_prefix, created_at`,
    [projectId, repoFullName, platform, pathPrefix],
  );

  return { ok: true, link: toLink(rows[0]) };
}

/**
 * Remove ONE link. False when the project is not the caller's, or nothing
 * matched.
 *
 * `pathPrefix` is an exact match, and an absent one means the WHOLE-REPOSITORY
 * link (`""`) — not "every link for this repository". The asymmetry matters
 * because deleting too much fails silently: an old client, a retried script or
 * a stale bookmark would remove the `apps/ios` and `apps/webapp` links somebody
 * else added, nothing would error, and promotion for two platforms would simply
 * stop until someone noticed a merge doing nothing. Deleting one link too few
 * is a visible 404. It is also exactly symmetric with `linkRepo`, where an
 * absent path means the whole repository too.
 */
export async function unlinkRepo(
  projectId: string,
  ownerIds: readonly string[],
  repoFullName: string,
  pathPrefix: string = "",
): Promise<boolean> {
  if (!(await ownsProject(projectId, ownerIds))) return false;
  const normalized = normalizePathPrefix(pathPrefix);
  // A prefix that cannot be normalised cannot name a stored row, so there is
  // nothing to delete — reported as "nothing matched" rather than as an error,
  // which is the same answer a well-formed prefix nobody linked would get.
  if (normalized === null) return false;
  const { rows } = await query<{ repo_full_name: string }>(
    `delete from project_repos
      where project_id = $1 and provider = 'github' and repo_full_name = $2 and path_prefix = $3
      returning repo_full_name`,
    [projectId, repoFullName.trim().toLowerCase(), normalized],
  );
  return rows.length > 0;
}
