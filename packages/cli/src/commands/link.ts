/**
 * `arkaik link [--project <id>] [--remote <url>] [--list] [path]`.
 *
 * Points a repo at a hosted Arkaik project, so a coding agent running here can
 * read and edit that project through `arkaik-mcp`. This plus a token is the
 * entire per-repo setup — the thing that has to stay trivial if the workflow is
 * to be worth repeating across every project a person owns.
 *
 * Writes `docs/arkaik/arkaik.json`:
 *
 *   { "project_id": "prj_…", "remote": "https://arkaik.app" }
 *
 * THE TOKEN IS NEVER WRITTEN THERE. It is read from $ARKAIK_TOKEN at run time,
 * because a credential in a repo file is a credential in a git history. The
 * link file is safe to commit; the token is not.
 *
 * `--list` prints the projects the token can see, so the id can be chosen
 * without leaving the terminal.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const LINK_FILE = "docs/arkaik/arkaik.json";
const DEFAULT_BASE_URL = "https://arkaik.app";

const USAGE = `arkaik link — point this repo at a hosted Arkaik project

Usage:
  arkaik link --project <id> [--remote <url>] [path]
  arkaik link --list [--remote <url>]

Options:
  --project <id>    The hosted project id (prj_…).
  --remote <url>    Instance origin. Default: ${DEFAULT_BASE_URL}
  --list            List the projects this token can reach, then exit.
  -h, --help        Show this help.

Environment:
  ARKAIK_TOKEN      Required. Create one at <origin>/settings/tokens.

Writes ${LINK_FILE} with the project id and origin — safe to commit.
The token is never written to disk.`;

export interface RunLinkOptions {
  /** Injectable for tests; defaults to the global fetch. */
  httpClient?: typeof fetch;
  cwd?: string;
  env?: Record<string, string | undefined>;
  log?: (message: string) => void;
  errorLog?: (message: string) => void;
}

function flagValue(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index !== -1 ? argv[index + 1] : undefined;
}

export interface LinkResult {
  ok: boolean;
  /** The path written, when a link was established. */
  path?: string;
  projectId?: string;
  baseUrl?: string;
}

export async function runLink(argv: string[], options: RunLinkOptions = {}): Promise<LinkResult> {
  const log = options.log ?? ((m: string) => console.log(m));
  const errorLog = options.errorLog ?? ((m: string) => console.error(m));
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const doFetch = options.httpClient ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  if (argv.includes("--help") || argv.includes("-h")) {
    log(USAGE);
    return { ok: true };
  }

  const baseUrl = (flagValue(argv, "--remote") ?? env.ARKAIK_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const token = env.ARKAIK_TOKEN;
  if (!token) {
    errorLog(`ARKAIK_TOKEN is not set. Create a token at ${baseUrl}/settings/tokens and export it.`);
    return { ok: false };
  }

  if (argv.includes("--list")) {
    const res = await doFetch(`${baseUrl}/api/graph/projects`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      errorLog(describeFailure(res.status, baseUrl));
      return { ok: false };
    }
    const body = (await res.json()) as { projects: Array<{ id: string; title: string; nodeCount: number }> };
    if (body.projects.length === 0) {
      log("No hosted projects yet. Create one in the app, or move a local project to your account.");
      return { ok: true };
    }
    for (const project of body.projects) {
      log(`  ${project.id}  ${project.title} (${project.nodeCount} nodes)`);
    }
    return { ok: true };
  }

  const projectId = flagValue(argv, "--project");
  if (!projectId) {
    errorLog("A project is required: arkaik link --project <id>   (or --list to see them)");
    return { ok: false };
  }

  // Verify the link before writing it. A file that names a project the token
  // cannot reach would fail later, inside an agent session, where the cause is
  // far less obvious than it is here.
  const res = await doFetch(`${baseUrl}/api/graph/projects/${encodeURIComponent(projectId)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    errorLog(describeFailure(res.status, baseUrl, projectId));
    return { ok: false };
  }
  const { bundle } = (await res.json()) as { bundle: { project: { title: string } } };

  const target = resolve(cwd, argv.find((a) => !a.startsWith("--") && a !== projectId && a !== baseUrl) ?? ".");
  const linkPath = join(target, LINK_FILE);
  mkdirSync(dirname(linkPath), { recursive: true });

  // Preserve any unknown keys — this file is the natural home for future
  // per-repo settings, and clobbering them on every link would be hostile.
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(readFileSync(linkPath, "utf8")) as Record<string, unknown>;
  } catch {
    // absent or unreadable — a fresh link
  }

  writeFileSync(
    linkPath,
    `${JSON.stringify({ ...existing, project_id: projectId, remote: baseUrl }, null, 2)}\n`,
  );

  log(`Linked to "${bundle.project.title}" (${projectId}).`);
  log(`Wrote ${LINK_FILE} — safe to commit; the token stays in your environment.`);
  log("");
  log("Your coding agent can now reach this project:");
  log("  npx -y arkaik-mcp            # picks up the link file automatically");

  return { ok: true, path: linkPath, projectId, baseUrl };
}

function describeFailure(status: number, baseUrl: string, projectId?: string): string {
  if (status === 401) return `Unauthorized — check ARKAIK_TOKEN (create one at ${baseUrl}/settings/tokens).`;
  if (status === 403) return "Forbidden — this token lacks the graph:read scope.";
  if (status === 404) {
    return projectId
      ? `No project "${projectId}" in this account. Run \`arkaik link --list\` to see the ids.`
      : "Not found.";
  }
  return `Request failed (${status}).`;
}

export function runLinkCli(argv: string[]): void {
  void runLink(argv).then((result) => {
    if (!result.ok) process.exit(1);
  });
}
