import { GUARDED_HOTKEY, useShortcut } from "@/lib/hooks/useShortcut";
import { isEditableElement } from "@/lib/utils/keyboard";

/**
 * Surface-scoped shortcuts. Export used to live here too, and no longer does:
 * it acts on the project rather than on what a surface has selected, so it is
 * registered once in `app/project/[id]/layout.tsx` — two registrations would
 * have raced on the map that mounted this hook. Escape is the panel stack's.
 */
interface KeyboardShortcutOptions {
  onDelete: () => void;
}

export function useKeyboardShortcuts({ onDelete }: KeyboardShortcutOptions): void {
  // Guarded: Backspace in a field (including role=textbox, which TanStack's own
  // input check does not know) must stay a Backspace.
  useShortcut(
    "delete-node",
    (event) => {
      if (event.defaultPrevented || event.repeat) return;
      if (isEditableElement(event.target)) return;
      event.preventDefault();
      onDelete();
    },
    GUARDED_HOTKEY,
  );
}
