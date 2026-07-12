/**
 * External ref-status providers for `arkaik sync` (issue #222,
 * docs/spec/bundle-format.md § References, docs/vision.md § References, Assets
 * & Integrations).
 *
 * A small registry keyed by ref `type`, so GitLab/Linear can be filled in later
 * without touching the sync command. Each provider is either:
 *  - `"live"` — has a working `fetchStatus`, called by `fetchRefStatus`;
 *  - `"stub"` — registered so its ref types are recognized and reported (not
 *    silently mistaken for an unknown type), but has no `fetchStatus`; the sync
 *    command skips these with a notice rather than calling them.
 *
 * The only network call in this module goes through the injected {@link
 * HttpClient} — never a bare `fetch` — so `arkaik sync`'s tests (and CI) can
 * substitute a mock and guarantee no real network happens. `DEFAULT_HTTP_CLIENT`
 * is the real implementation (Node 20+'s global `fetch`), wired in only by the
 * CLI entry point, never by tests.
 */

/** The HTTP seam every provider call goes through — mockable in tests. */
export type HttpClient = (url: string, init?: RequestInit) => Promise<Response>;

/** The real HTTP client: Node's global `fetch`. Used by the CLI, never by tests. */
export const DEFAULT_HTTP_CLIENT: HttpClient = (url, init) => fetch(url, init);

/** What a provider's `fetchStatus` needs about one ref, plus the injected seam. */
export interface FetchContext {
  /** Token from the provider's env var, when present. */
  token?: string;
  httpClient: HttpClient;
}

/** The minimal ref shape a provider needs: its type (to route) and URL (to query). */
export interface RefLike {
  type: string;
  url: string;
}

export interface ProviderDef {
  /** Provider name, matched against `--provider <name>`. */
  name: string;
  /** Ref `type` values this provider handles. */
  refTypes: readonly string[];
  status: "live" | "stub";
  /** Env var a token is read from (documented in `arkaik sync --help`). */
  tokenEnvVar?: string;
  /** Present only for `"live"` providers. */
  fetchStatus?: (ref: RefLike, ctx: FetchContext) => Promise<string>;
}

const GITHUB_ISSUE_URL_RE = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)(?:[/?#].*)?$/;
const GITHUB_PR_URL_RE = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:[/?#].*)?$/;

function githubHeaders(token: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function getGithubJson(
  httpClient: HttpClient,
  url: string,
  token: string | undefined,
  refUrl: string,
): Promise<Record<string, unknown>> {
  const res = await httpClient(url, { headers: githubHeaders(token) });
  if (!res.ok) throw new Error(`GitHub API error ${res.status} for ${refUrl}`);
  const body: unknown = await res.json();
  if (typeof body !== "object" || body === null) {
    throw new Error(`GitHub API returned a non-object response for ${refUrl}`);
  }
  return body as Record<string, unknown>;
}

/** `github-issue`: mirrors the issue's `state` verbatim ("open" | "closed"). */
async function fetchGithubIssueStatus(ref: RefLike, ctx: FetchContext): Promise<string> {
  const m = GITHUB_ISSUE_URL_RE.exec(ref.url);
  if (!m) throw new Error(`Cannot parse a GitHub issue URL: ${ref.url}`);
  const [, owner, repo, number] = m;
  const body = await getGithubJson(
    ctx.httpClient,
    `https://api.github.com/repos/${owner}/${repo}/issues/${number}`,
    ctx.token,
    ref.url,
  );
  if (typeof body.state !== "string") throw new Error(`GitHub API response missing "state" for ${ref.url}`);
  return body.state;
}

/** `github-pr`: "merged" when merged, else the PR's `state` ("open" | "closed"). */
async function fetchGithubPrStatus(ref: RefLike, ctx: FetchContext): Promise<string> {
  const m = GITHUB_PR_URL_RE.exec(ref.url);
  if (!m) throw new Error(`Cannot parse a GitHub pull request URL: ${ref.url}`);
  const [, owner, repo, number] = m;
  const body = await getGithubJson(
    ctx.httpClient,
    `https://api.github.com/repos/${owner}/${repo}/pulls/${number}`,
    ctx.token,
    ref.url,
  );
  if (typeof body.state !== "string") throw new Error(`GitHub API response missing "state" for ${ref.url}`);
  return body.merged === true ? "merged" : body.state;
}

async function fetchGithubStatus(ref: RefLike, ctx: FetchContext): Promise<string> {
  if (ref.type === "github-issue") return fetchGithubIssueStatus(ref, ctx);
  if (ref.type === "github-pr") return fetchGithubPrStatus(ref, ctx);
  throw new Error(`Unsupported GitHub ref type: ${ref.type}`);
}

/**
 * Provider registry (v1). GitHub is fully live. GitLab/Linear are registered as
 * documented stubs so their ref types are recognized (reported + skipped with a
 * notice) rather than treated as unknown — filling them in later is a matter of
 * adding a `fetchStatus` and flipping `status` to `"live"`.
 */
export const PROVIDERS: readonly ProviderDef[] = [
  {
    name: "github",
    refTypes: ["github-issue", "github-pr"],
    status: "live",
    tokenEnvVar: "GITHUB_TOKEN",
    fetchStatus: fetchGithubStatus,
  },
  {
    name: "gitlab",
    refTypes: ["gitlab-issue", "gitlab-mr"],
    status: "stub",
    tokenEnvVar: "GITLAB_TOKEN",
  },
  {
    name: "linear",
    refTypes: ["linear-issue"],
    status: "stub",
    tokenEnvVar: "LINEAR_API_KEY",
  },
];

const REF_TYPE_TO_PROVIDER = new Map<string, ProviderDef>();
for (const provider of PROVIDERS) {
  for (const type of provider.refTypes) REF_TYPE_TO_PROVIDER.set(type, provider);
}

/** The registered provider for a ref `type`, or `undefined` for an unknown/unsupported type. */
export function providerForType(refType: string): ProviderDef | undefined {
  return REF_TYPE_TO_PROVIDER.get(refType);
}

/**
 * Fetch `ref`'s current external status through its provider. Only callable for
 * a `"live"` provider — the sync command checks `providerForType(...).status`
 * before calling this, so a stub or unknown type never reaches here.
 */
export async function fetchRefStatus(ref: RefLike, ctx: FetchContext): Promise<string> {
  const provider = providerForType(ref.type);
  if (!provider || provider.status !== "live" || !provider.fetchStatus) {
    throw new Error(`No live provider for ref type "${ref.type}"`);
  }
  return provider.fetchStatus(ref, ctx);
}
