import type { Project } from "@/lib/data/types";

export function exportToJson(project: Project): string {
  return JSON.stringify(project, null, 2);
}

export function downloadJson(project: Project): void {
  const json = exportToJson(project);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${project.id}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
