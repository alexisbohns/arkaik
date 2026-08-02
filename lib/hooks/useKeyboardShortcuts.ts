import { useEffect } from "react";
import { isDeleteShortcut, isEditableElement } from "@/lib/utils/keyboard";

/**
 * Surface-scoped shortcuts. Export used to live here too, and no longer does:
 * it acts on the project rather than on what a surface has selected, so it is
 * registered once in `app/project/[id]/layout.tsx` — two registrations would
 * have raced on the map that mounted this hook.
 */
interface KeyboardShortcutOptions {
  /** Optional: while the panel stack is non-empty, Escape belongs to it. */
  onEscape?: () => void;
  onDelete: () => void;
}

export function useKeyboardShortcuts({
  onEscape,
  onDelete,
}: KeyboardShortcutOptions): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) {
        return;
      }

      if (event.key === "Escape") {
        onEscape?.();
        return;
      }

      if (isDeleteShortcut(event)) {
        if (isEditableElement(event.target)) {
          return;
        }

        event.preventDefault();
        onDelete();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onDelete, onEscape]);
}
