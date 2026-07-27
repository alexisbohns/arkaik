import "server-only";

import { query } from "@/lib/services/db";

/**
 * Repository links (db/migrations/009_project_repos.sql) — the rows the GitHub
 * webhook resolves a delivery against.
 *
 * Without a link, a webhook for a repo finds no projects and does nothing, so
 * this is the surface that makes PR-driven transitions reachable at all.
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
  createdAt: string;
}

export type RepoLinkFailure =
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "invalid_repo" }
  | { ok: false; reason: "invalid_platform" };

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
  const { rows } = await query<{ repo_full_name: string; platform: string | null; created_at: Date }>(
    `select repo_full_name, platform, created_at
       from project_repos
      where project_id = $1 and provider = 'github'
      order by repo_full_name`,
    [projectId],
  );
  return rows.map((row) => ({
    repoFullName: row.repo_full_name,
    platform: row.platform,
    createdAt: row.created_at.toISOString(),
  }));
}

/**
 * Link a repository, or update the platform of an existing link.
 *
 * The name is lowercased on write because GitHub treats repository names
 * case-insensitively and webhook payloads make no promise about which case they
 * deliver — a link stored as `Acme/App` would never match a delivery for
 * `acme/app`, and the failure would be silent.
 */
export async function linkRepo(
  projectId: string,
  ownerIds: readonly string[],
  input: { repoFullName: string; platform?: string | null },
): Promise<{ ok: true; link: RepoLink } | RepoLinkFailure> {
  if (!(await ownsProject(projectId, ownerIds))) return { ok: false, reason: "not_found" };

  const repoFullName = input.repoFullName.trim().toLowerCase();
  if (!REPO_PATTERN.test(repoFullName)) return { ok: false, reason: "invalid_repo" };

  const platform = input.platform ?? null;
  if (platform !== null && !PLATFORMS.has(platform)) return { ok: false, reason: "invalid_platform" };

  const { rows } = await query<{ repo_full_name: string; platform: string | null; created_at: Date }>(
    `insert into project_repos (project_id, provider, repo_full_name, platform)
     values ($1, 'github', $2, $3)
     on conflict (project_id, provider, repo_full_name)
       do update set platform = excluded.platform
     returning repo_full_name, platform, created_at`,
    [projectId, repoFullName, platform],
  );

  const row = rows[0];
  return {
    ok: true,
    link: {
      repoFullName: row.repo_full_name,
      platform: row.platform,
      createdAt: row.created_at.toISOString(),
    },
  };
}

/** Remove a link. False when the project is not the caller's, or nothing matched. */
export async function unlinkRepo(
  projectId: string,
  ownerIds: readonly string[],
  repoFullName: string,
): Promise<boolean> {
  if (!(await ownsProject(projectId, ownerIds))) return false;
  const { rows } = await query<{ repo_full_name: string }>(
    `delete from project_repos
      where project_id = $1 and provider = 'github' and repo_full_name = $2
      returning repo_full_name`,
    [projectId, repoFullName.trim().toLowerCase()],
  );
  return rows.length > 0;
}
