import type { Project, ProjectBundle } from "@/lib/data/types";
import { localProvider } from "@/lib/data/local-provider";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isValidIsoString(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function normalizeProjectTimestamps(project: Project): Project {
  const now = new Date().toISOString();
  return {
    ...project,
    created_at: isValidIsoString(project.created_at) ? project.created_at : now,
    updated_at: isValidIsoString(project.updated_at) ? project.updated_at : now,
    archived_at: isValidIsoString(project.archived_at) ? project.archived_at : null,
  };
}

function assertProjectBundleShape(value: unknown): asserts value is ProjectBundle {
  if (!isRecord(value)) throw new Error("Invalid JSON: expected object root");

  const project = value.project;
  if (!isRecord(project)) throw new Error("Invalid JSON: missing project object");
  if (typeof project.id !== "string" || !project.id.trim()) {
    throw new Error("Invalid JSON: project.id must be a non-empty string");
  }
  if (typeof project.title !== "string" || !project.title.trim()) {
    throw new Error("Invalid JSON: project.title must be a non-empty string");
  }

  if (!Array.isArray(value.nodes)) {
    throw new Error("Invalid JSON: nodes must be an array");
  }
  if (!Array.isArray(value.edges)) {
    throw new Error("Invalid JSON: edges must be an array");
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

export function downloadJson(bundle: ProjectBundle): void {
  const json = exportToJson(bundle);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${bundle.project.id}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
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
