/**
 * Hands the reader a text file: a Blob, an object URL and a temporary link,
 * the technique `downloadJson` uses for a project bundle
 * (lib/utils/export.ts). Browser only; call it from an event handler.
 */
export function downloadTextFile(filename: string, text: string, type = "application/json"): void {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
