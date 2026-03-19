import type { ProjectBundle } from "@/lib/data/types";

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
