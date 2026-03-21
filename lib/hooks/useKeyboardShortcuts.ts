import { useEffect } from "react";
import { isDeleteShortcut, isEditableElement, isExportShortcut } from "@/lib/utils/keyboard";

interface KeyboardShortcutOptions {
  onEscape: () => void;
  onDelete: () => void;
  onExport: () => void;
}

export function useKeyboardShortcuts({
  onEscape,
  onDelete,
  onExport,
}: KeyboardShortcutOptions): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) {
        return;
      }

      if (isExportShortcut(event)) {
        if (isEditableElement(event.target)) {
          return;
        }
        event.preventDefault();
        onExport();
        return;
      }

      if (event.key === "Escape") {
        onEscape();
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
  }, [onDelete, onEscape, onExport]);
}
