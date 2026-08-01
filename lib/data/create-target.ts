import type { ProjectBundle } from "./types";

const CREATE_TARGETS = ["hosted", "synked", "lokal"] as const;

/**
 * Where a newly created project should land — one per section on `/projects`.
 * Doubles as the name of the section a project already sits in: `sectionFor` in
 * `./project-sections` returns one of these too.
 */
export type CreateTarget = (typeof CREATE_TARGETS)[number];

/**
 * Read a `CreateTarget` off untrusted input — a `?target=` or `?import=` query
 * param that survived a round trip through `/generate` and an external LLM.
 *
 * Returns `null` rather than throwing or defaulting, so the caller can decide
 * that a lost intent simply means "ask me again" instead of silently creating a
 * project in the wrong place.
 */
export function parseCreateTarget(value: string | null | undefined): CreateTarget | null {
  if (!value) return null;
  return CREATE_TARGETS.find((target) => target === value) ?? null;
}

/** The three effects {@link createInTarget} needs, injected so it stays testable in Node. */
export interface CreateTargetDeps {
  /** Persist a bundle in this browser. Resolves to the stored project id. */
  saveLocal(bundle: ProjectBundle): Promise<string>;
  /** Persist a bundle in the account. Resolves to the SERVER-minted project id. */
  importHosted(bundle: ProjectBundle): Promise<string>;
  /** Push a local project to Synk now. */
  backupNow(projectId: string): Promise<void>;
}

export interface CreateTargetResult {
  /** The id the project actually got — server-minted for hosted, local otherwise. */
  id: string;
  /**
   * Why the immediate backup failed, or `null`. Non-null means the project
   * exists but landed in Lokal rather than Synked.
   */
  backupError: string | null;
}

/**
 * Create a project in the place the user asked for.
 *
 * Hosted goes straight to the account — no local write, no "move to account"
 * detour afterwards. Synked writes locally and then backs up, and a failed
 * backup is REPORTED, NOT THROWN: the user asked for a project, so they get a
 * project; it just sits in Lokal until the next backup succeeds. A failed
 * *save* is a different matter and propagates, because then there is no project
 * at all.
 */
export async function createInTarget(
  target: CreateTarget,
  bundle: ProjectBundle,
  deps: CreateTargetDeps
): Promise<CreateTargetResult> {
  if (target === "hosted") {
    return { id: await deps.importHosted(bundle), backupError: null };
  }

  const id = await deps.saveLocal(bundle);
  if (target === "lokal") return { id, backupError: null };

  try {
    await deps.backupNow(id);
    return { id, backupError: null };
  } catch (err) {
    return { id, backupError: err instanceof Error && err.message ? err.message : "Backup failed" };
  }
}
