import type { Project, ProjectBundle } from "@/lib/data/types";
import { localProvider } from "@/lib/data/local-provider";

const MAX_RECOMMENDED_EXPORT_BYTES = 4 * 1024 * 1024;

export interface ExportDownloadResult {
  filename: string;
  bytes: number;
  warning: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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

export function assertProjectBundleShape(value: unknown): asserts value is ProjectBundle {
  if (!isRecord(value)) throw new Error("Invalid JSON: expected object root");

  const project = value.project;
  if (!isRecord(project)) throw new Error("Invalid JSON: missing project object");
  if (typeof project.id !== "string" || !project.id.trim()) {
    throw new Error("Invalid JSON: project.id must be a non-empty string");
  }
  if (typeof project.title !== "string" || !project.title.trim()) {
    throw new Error("Invalid JSON: project.title must be a non-empty string");
  }
  if (project.root_node_id !== undefined && typeof project.root_node_id !== "string") {
    throw new Error("Invalid JSON: project.root_node_id must be a string when provided");
  }
  if (project.metadata !== undefined) {
    if (!isRecord(project.metadata)) {
      throw new Error("Invalid JSON: project.metadata must be an object when provided");
    }
    const viewCardVariant = project.metadata.view_card_variant;
    if (
      viewCardVariant !== undefined
      && viewCardVariant !== "compact"
      && viewCardVariant !== "large"
    ) {
      throw new Error("Invalid JSON: project.metadata.view_card_variant must be compact or large");
    }
  }

  if (!Array.isArray(value.nodes)) {
    throw new Error("Invalid JSON: nodes must be an array");
  }
  if (!Array.isArray(value.edges)) {
    throw new Error("Invalid JSON: edges must be an array");
  }

  if (typeof project.root_node_id === "string") {
    const nodeIds = new Set(
      value.nodes
        .filter(isRecord)
        .map((node) => node.id)
        .filter((id): id is string => typeof id === "string"),
    );
    if (!nodeIds.has(project.root_node_id)) {
      throw new Error("Invalid JSON: project.root_node_id must reference an existing node id");
    }
  }
}

async function ensureUniqueProjectId(initialId: string): Promise<string> {
  let candidate = initialId;
  while (await localProvider.getProject(candidate)) {
    candidate = crypto.randomUUID();
  }
  return candidate;
}

function rewriteBundleProjectId(bundle: ProjectBundle, newProjectId: string): ProjectBundle {
  return {
    project: { ...bundle.project, id: newProjectId },
    nodes: bundle.nodes.map((node) => ({ ...node, project_id: newProjectId })),
    edges: bundle.edges.map((edge) => ({ ...edge, project_id: newProjectId })),
  };
}

export function exportToJson(bundle: ProjectBundle): string {
  return JSON.stringify(bundle, null, 2);
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
 * Exports a project by ID, returning a {@link ProjectBundle} containing the
 * project metadata, all nodes, and all edges.
 */
export async function exportProject(id: string): Promise<ProjectBundle> {
  return localProvider.exportProject(id);
}

/**
 * Imports a {@link ProjectBundle}, creating the project, nodes, and edges in
 * storage. Returns the created {@link Project}.
 */
export async function importProject(bundle: ProjectBundle): Promise<Project> {
  return localProvider.importProject(bundle);
}

export async function archiveProject(id: string): Promise<void> {
  return localProvider.archiveProject(id);
}

/**
 * Imports a project bundle from a user-selected JSON file.
 * If the project id already exists locally, a new id is generated.
 */
export async function importProjectFromFile(file: File): Promise<Project> {
  const rawText = await file.text();
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error("Invalid JSON file");
  }

  assertProjectBundleShape(parsed);

  const normalizedBundle: ProjectBundle = {
    ...parsed,
    project: normalizeProjectTimestamps(parsed.project),
  };

  const resolvedProjectId = await ensureUniqueProjectId(normalizedBundle.project.id);
  const finalBundle =
    resolvedProjectId === normalizedBundle.project.id
      ? normalizedBundle
      : rewriteBundleProjectId(normalizedBundle, resolvedProjectId);

  return localProvider.importProject(finalBundle);
}
