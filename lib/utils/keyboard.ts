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

/**
 * A platform key toggles: pressing the platform already selected goes back to
 * all platforms, anything else selects the pressed one.
 */
export function nextPlatformFilter<P extends string>(current: "all" | P, pressed: P): "all" | P {
  return current === pressed ? "all" : pressed;
}
