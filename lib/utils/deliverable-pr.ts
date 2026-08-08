/**
 * Recovering a pull request number from a deliverable.
 *
 * Nothing in the journal stores the number as a number. Two places imply it,
 * and they disagree often enough to need an order:
 *
 * 1. `deliverable_id`, which the CLI mints as `pr-<n>` by convention
 *    (`arkaik deliverable --id`) — but only by convention: `--id` takes any
 *    string, and an id-less deliverable gets a ULID.
 * 2. The `url`, which is authoritative when it is a GitHub/GitLab PR link.
 *
 * The URL wins when both parse and disagree: the id is a local naming habit,
 * the URL is where the reader will actually land. Kept pure and DOM-free so it
 * can be tested without a browser or a database.
 */

/** `.../pull/123`, `.../pulls/123`, GitLab's `.../merge_requests/123`. */
const URL_PR = /\/(?:pull|pulls|merge_requests)\/(\d+)(?:[/?#]|$)/;

/** `pr-123`, `pr_123`, `pr123` — the CLI's `--id` convention and its near misses. */
const ID_PR = /^(?:pr|mr)[-_]?(\d+)$/i;

/**
 * The pull request number a deliverable points at, or `null` when neither its
 * URL nor its id yields one (a hand-written deliverable, or a ULID id with a
 * non-PR link).
 */
export function prNumberOf(deliverable: { deliverable_id?: string; url?: string }): number | null {
  const fromUrl = deliverable.url === undefined ? null : URL_PR.exec(deliverable.url);
  if (fromUrl) return Number(fromUrl[1]);

  const fromId = deliverable.deliverable_id === undefined ? null : ID_PR.exec(deliverable.deliverable_id);
  if (fromId) return Number(fromId[1]);

  return null;
}

/**
 * `owner/repo` from a forge URL, or `null` when the URL is not one.
 *
 * Read off the path rather than a host allowlist: GitHub Enterprise and
 * self-hosted GitLab live on their own domains, and a preview that refuses to
 * name the repository because the host is not `github.com` would be wrong
 * exactly where naming it matters most. GitLab's `/-/` infix (and its nested
 * subgroups) is why the owner segment is the *first* and the repo the segment
 * before the separator, rather than a fixed pair.
 */
export function repoFromUrl(url: string | undefined): string | null {
  if (url === undefined) return null;

  // Everything before `/pull|pulls|merge_requests/`, minus GitLab's `/-` infix.
  const beforePr = url.split(/\/(?:pull|pulls|merge_requests)\//)[0];
  if (beforePr === url) return null;

  const path = beforePr
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
    .replace(/\/-$/, "")
    .split("/");
  // [host, owner, ...groups, repo] — at least a host, an owner and a repo.
  if (path.length < 3) return null;

  const repo = path[path.length - 1];
  const owner = path[1];
  if (owner === "" || repo === "") return null;
  return `${owner}/${repo}`;
}
