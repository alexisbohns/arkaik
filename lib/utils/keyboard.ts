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

/** ⌘K / Ctrl+K — the command palette. Unlike the destructive shortcuts it is
 * deliberately live inside inputs too: a modifier chord never competes with
 * typing, and a palette you have to click out of a field to reach is a palette
 * nobody uses. */
export function isCommandPaletteShortcut(event: KeyboardEvent): boolean {
  if (event.altKey || event.shiftKey) {
    return false;
  }

  if (!event.metaKey && !event.ctrlKey) {
    return false;
  }

  return event.key.toLowerCase() === "k";
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
