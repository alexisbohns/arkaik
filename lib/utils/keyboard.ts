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

export function isDeleteShortcut(event: KeyboardEvent): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey) {
    return false;
  }

  return event.key === "Delete" || event.key === "Backspace";
}

export function isExportShortcut(event: KeyboardEvent): boolean {
  if (event.altKey || event.shiftKey) {
    return false;
  }

  const isMod = event.metaKey || event.ctrlKey;
  if (!isMod) {
    return false;
  }

  return event.key.toLowerCase() === "e";
}
