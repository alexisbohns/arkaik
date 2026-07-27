/**
 * Resolving "which project, where, with what credential" for hosted mode.
 *
 * The link file (`docs/arkaik/arkaik.json`, written by `arkaik link`) carries
 * the project id and origin, because those are per-repo facts worth committing.
 * The TOKEN never appears there and is only ever read from the environment — a
 * credential in a repo file is a credential in a git history.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Where `arkaik link` writes, relative to the repo root. */
export const LINK_FILE = "docs/arkaik/arkaik.json";

/** The public instance, used when nothing names another. */
export const DEFAULT_BASE_URL = "https://arkaik.app";

export interface LinkFile {
  project_id?: string;
  remote?: string;
}

export type RemoteConfig =
  | { mode: "file" }
  | { mode: "remote"; projectId: string; baseUrl: string; token: string };

/** Read the link file, or null when absent/unreadable/malformed. */
export function readLinkFile(cwd: string): LinkFile | null {
  try {
    const parsed = JSON.parse(readFileSync(join(cwd, LINK_FILE), "utf8")) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed as LinkFile;
  } catch {
    return null;
  }
}

function flagValue(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return blankToUndefined(index !== -1 ? argv[index + 1] : undefined);
}

/**
 * Treat an empty or whitespace-only value as absent.
 *
 * `??` only falls back on null/undefined, so `ARKAIK_PROJECT=` in the
 * environment — which every shell and CI system produces when a variable is
 * declared but unset — would otherwise read as a real (empty) project id and
 * silently drop the session back to the repo bundle.
 */
function blankToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Decide the mode. Hosted mode is chosen when `--remote` is passed, or when a
 * project id is available from `--project`, `$ARKAIK_PROJECT`, or a link file.
 *
 * Choosing hosted mode WITHOUT a token is an error rather than a silent
 * fallback to the repo bundle: a linked repo that quietly served a stale local
 * file because a token expired is the kind of failure an agent cannot notice.
 */
export function resolveRemoteConfig(
  argv: readonly string[],
  env: Record<string, string | undefined>,
  cwd: string,
): RemoteConfig {
  const link = readLinkFile(cwd);
  const explicitRemote = argv.includes("--remote");
  const projectId =
    flagValue(argv, "--project") ?? blankToUndefined(env.ARKAIK_PROJECT) ?? blankToUndefined(link?.project_id);

  // An explicit --bundle always means the repo file, whatever else is set.
  if (argv.includes("--bundle") && !explicitRemote) return { mode: "file" };
  if (!explicitRemote && !projectId) return { mode: "file" };

  if (!projectId) {
    throw new Error(
      "--remote needs a project: pass --project <id>, set ARKAIK_PROJECT, or run `npx arkaik link`.",
    );
  }
  const token = blankToUndefined(env.ARKAIK_TOKEN);
  if (!token) {
    throw new Error(
      `ARKAIK_TOKEN is not set. Create a token at ${link?.remote ?? DEFAULT_BASE_URL}/settings/tokens and export it.`,
    );
  }

  return {
    mode: "remote",
    projectId,
    baseUrl: blankToUndefined(env.ARKAIK_URL) ?? blankToUndefined(link?.remote) ?? DEFAULT_BASE_URL,
    token,
  };
}
