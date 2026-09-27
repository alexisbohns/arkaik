export function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;

  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    return true;
  }

  if (target.isContentEditable) {
    return true;
  }

  const role = target.getAttribute("role");
  if (role === "textbox" || role === "combobox") {
    return true;
  }

  return target.closest("input, textarea, [contenteditable='true'], [role='textbox'], [role='combobox']") !== null;
}
