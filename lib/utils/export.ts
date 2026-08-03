import type { Project, ProjectBundle } from "@/lib/data/types";
import {
  migrateStatusVocabulary,
  parseBundle,
  serializeBundle,
  validateBundle,
  type ValidationFinding,
} from "@arkaik/schema";
import { getProvider } from "@/lib/data/provider-registry";
import { HOSTED_ID_PREFIX } from "@/lib/data/remote-provider";
import { SEED_PROJECT_ID } from "@/lib/data/seed-project-id";

const MAX_RECOMMENDED_EXPORT_BYTES = 4 * 1024 * 1024;

/** Cap on findings named in a thrown message so a broken bundle stays readable. */
const MAX_REPORTED_FINDINGS = 5;

export interface ExportDownloadResult {
  filename: string;
  bytes: number;
  warning: string | null;
}

function isValidIsoString(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

export function normalizeProjectTimestamps(project: Project): Project {
  const now = new Date().toISOString();
  return {
    ...project,
    created_at: isValidIsoString(project.created_at) ? project.created_at : now,
    updated_at: isValidIsoString(project.updated_at) ? project.updated_at : now,
    archived_at: isValidIsoString(project.archived_at) ? project.archived_at : null,
  };
}

/** Render a zod issue path (`["nodes", 3, "id"]`) as `nodes[3].id`. */
function formatIssuePath(path: ReadonlyArray<PropertyKey>): string {
  let out = "";
  for (const key of path) {
    if (typeof key === "number") out += `[${key}]`;
    else out += out ? `.${String(key)}` : String(key);
  }
  return out || "(root)";
}

/** Join a capped list of `path: message` parts, noting how many were elided. */
function joinReported(parts: string[]): string {
  const shown = parts.slice(0, MAX_REPORTED_FINDINGS);
  const extra = parts.length - shown.length;
  return shown.join("; ") + (extra > 0 ? ` (and ${extra} more)` : "");
}

/**
 * Parse and semantically validate an untrusted bundle against the canonical
 * `@arkaik/schema` rules (`parseBundle` for shape, `validateBundle` for the
 * graph rules JSON Schema cannot express — duplicate IDs, dangling edge refs,
 * etc.). Returns the typed {@link ProjectBundle} on success; throws an Error
 * with a readable, path-specific message on the first batch of failures.
 * Warnings (e.g. the stale edge-ID convention) never block.
 *
 * The gate order is the same one every server load path uses
 * (lib/services/graph/store.ts `validateInboundBundle`): parse → migrate →
 * validate — and it is load-bearing. The shape parse is legacy-tolerant
 * (`AnyStatusSchema`) precisely so `migrateStatusVocabulary` can erase legacy
 * status ids before `validateBundle`, which enforces the strict current
 * vocabulary; validating the raw input would refuse every pre-v3 bundle. On
 * success the MIGRATED bundle is returned — that is what callers must keep, so
 * post-v3 data is never stored under a pre-v3 stamp.
 */
export function parseAndValidateBundle(value: unknown): ProjectBundle {
  const parsed = parseBundle(value);
  if (!parsed.success) {
    const parts = parsed.error.issues.map(
      (issue) => `${formatIssuePath(issue.path)}: ${issue.message}`,
    );
    throw new Error(`Invalid bundle: ${joinReported(parts)}`);
  }

  // Migrate the raw input rather than `parsed.data` so fields the zod schema
  // does not model survive verbatim (same reasoning as the server gate).
  const bundle = migrateStatusVocabulary(value as ProjectBundle);

  const { valid, errors } = validateBundle(bundle);
  if (!valid) {
    const parts = errors.map(
      (finding: ValidationFinding) =>
        finding.path ? `${finding.path}: ${finding.message}` : finding.message,
    );
    throw new Error(`Invalid bundle: ${joinReported(parts)}`);
  }

  return bundle;
}

/**
 * A free project id for an import: unique, never in the hosted namespace, and
 * never the reserved seed id.
 *
 * The `prj_` prefix is how the routing provider tells a hosted project from a
 * local one (lib/data/routing-provider.ts), and `arkaik-self-map` is how it
 * tells the built-in public seed project from either (lib/data/seed-project-id.ts).
 * Both rules are only sound if a local or imported project can never hold such
 * an id — otherwise an imported bundle whose author happened to name it
 * `prj_…` or `arkaik-self-map` would be routed to the server or the seed
 * provider, where it does not exist. Reserving both namespaces here is what
 * makes routing a total function of the id rather than a guess.
 */
async function ensureUniqueProjectId(initialId: string): Promise<string> {
  let candidate =
    initialId.startsWith(HOSTED_ID_PREFIX) || initialId === SEED_PROJECT_ID
      ? crypto.randomUUID()
      : initialId;
  while (await getProvider().getProject(candidate)) {
    candidate = crypto.randomUUID();
  }
  return candidate;
}

function rewriteBundleProjectId(bundle: ProjectBundle, newProjectId: string): ProjectBundle {
  return {
    ...bundle,
    project: { ...bundle.project, id: newProjectId },
    nodes: bundle.nodes.map((node) => ({ ...node, project_id: newProjectId })),
    edges: bundle.edges.map((edge) => ({ ...edge, project_id: newProjectId })),
  };
}

export function exportToJson(bundle: ProjectBundle): string {
  return serializeBundle(bundle);
}

function sanitizeFilenameSegment(input: string): string {
  const normalized = input.normalize("NFKD").replace(/[^\x00-\x7F]/g, "");
  const compact = normalized.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!compact) return "project";
  return compact.slice(0, 48);
}

function buildExportFilename(bundle: ProjectBundle): string {
  const titlePart = sanitizeFilenameSegment(bundle.project.title);
  return `${titlePart}-${bundle.project.id}.json`;
}

function buildExportWarning(bytes: number): string | null {
  if (bytes <= MAX_RECOMMENDED_EXPORT_BYTES) return null;
  const sizeMb = (bytes / (1024 * 1024)).toFixed(1);
  return `Large export (${sizeMb} MB). This may be hard to share or import on some devices.`;
}

export function downloadJson(bundle: ProjectBundle): ExportDownloadResult {
  const json = exportToJson(bundle);
  const filename = buildExportFilename(bundle);
  const bytes = new Blob([json]).size;
  const warning = buildExportWarning(bytes);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  return { filename, bytes, warning };
}

/**
 * Dev-time cross-check for the app's journal *writer* role (issue #218). The
 * exported bundle now carries the app-emitted journal, so we run the same
 * `validateBundle` — which includes `crossCheckJournal` — the CLI/skill
 * dual-write is held to. A real emission bug (a `node.status_changed.to` that
 * disagrees with the snapshot, a dangling ref) surfaces here as a console
 * warning.
 *
 * Deliberately **non-blocking**: a project imported without a journal and then
 * edited legitimately has a *partial* journal (its pre-existing nodes lack a
 * `node.created`) — the expected Level 0/1 → 2 transition, not a corruption. We
 * never fail an export over it; a fully app-authored graph stays green by
 * construction (every node was created through `createNode`).
 */
function warnOnInvalidExport(bundle: ProjectBundle): void {
  const { valid, errors } = validateBundle(bundle);
  if (!valid) {
    console.warn(
      `[export] Bundle ${bundle.project.id} failed validation (${errors.length} error(s)):`,
      errors.map((f) => (f.path ? `${f.path}: ${f.message}` : f.message)),
    );
  }
}

/**
 * Exports a project by ID, returning a {@link ProjectBundle} containing the
 * project metadata, all nodes, edges, and the app-emitted journal.
 */
export async function exportProject(id: string): Promise<ProjectBundle> {
  const bundle = await getProvider().exportProject(id);
  warnOnInvalidExport(bundle);
  return bundle;
}

/**
 * Imports a {@link ProjectBundle}, creating the project, nodes, and edges in
 * storage. Returns the created {@link Project}.
 */
export async function importProject(bundle: ProjectBundle): Promise<Project> {
  return getProvider().importProject(bundle);
}

export async function archiveProject(id: string): Promise<void> {
  return getProvider().archiveProject(id);
}

/**
 * Reads a user-selected JSON file into a validated, timestamp-normalized
 * {@link ProjectBundle} — WITHOUT storing it anywhere.
 *
 * Split out of {@link importProjectFromFile} because the hosted import path
 * must not write to this browser on its way to the account: the bundle goes
 * straight to `importProject` on the remote provider, which mints its own id.
 * The local path below still does the id-uniquing this one deliberately skips.
 */
export async function parseBundleFromFile(file: File): Promise<ProjectBundle> {
  const rawText = await file.text();
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error("Invalid JSON file");
  }

  const bundle = parseAndValidateBundle(parsed);
  return { ...bundle, project: normalizeProjectTimestamps(bundle.project) };
}

/**
 * Imports a project bundle from a user-selected JSON file.
 * If the project id already exists locally, a new id is generated.
 */
export async function importProjectFromFile(file: File): Promise<Project> {
  const normalizedBundle = await parseBundleFromFile(file);

  const resolvedProjectId = await ensureUniqueProjectId(normalizedBundle.project.id);
  const finalBundle =
    resolvedProjectId === normalizedBundle.project.id
      ? normalizedBundle
      : rewriteBundleProjectId(normalizedBundle, resolvedProjectId);

  return getProvider().importProject(finalBundle);
}
