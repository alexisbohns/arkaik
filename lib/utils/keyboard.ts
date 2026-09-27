/**
 * Radix marks its open layers in the DOM. With a dialog, popover, select, or
 * menu open — over a panel, or over a toolbar behind it — keys belong to that
 * layer, not to whatever is underneath: Escape is the open layer's to close,
 * and a bare toolbar letter (`i`/`w`/`a`/`c`, ⌥E) must not reach through it and
 * act on the surface behind. A Radix `Select` and `Combobox` open as
 * `role="listbox"`, a dropdown or context menu as `role="menu"`, a dialog or
 * alert dialog as `role="dialog"`/`role="alertdialog"` — each with
 * `data-state="open"` for as long as it is.
 */
export const OPEN_OVERLAY_SELECTOR = [
  "[role='dialog'][data-state='open']",
  "[role='alertdialog'][data-state='open']",
  "[role='listbox'][data-state='open']",
  "[role='menu'][data-state='open']",
].join(", ");

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
