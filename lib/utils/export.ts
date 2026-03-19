import type { Project, ProjectBundle } from "@/lib/data/types";
import { localProvider } from "@/lib/data/local-provider";

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
