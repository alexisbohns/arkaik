"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

/** How long the confirmation mark stays up — long enough to notice, short enough to forget. */
const COPIED_RESET_MS = 1500;

/**
 * Copy an entity id to the clipboard, with the confirmation state the two chips
 * that do it both need.
 *
 * Extracted because there are two of them and they must not drift: the row chip
 * (`EntityChip`, which shows the species glyph) and the panel header's collapsed
 * chip (`PanelHeaderEntityId`, which shows a hash). Same gesture, same mark,
 * same toast, one implementation.
 *
 * The toast is not redundant with the mark. The mark answers the reader whose
 * pointer is still on the chip; the toast reaches the one whose eye has already
 * moved on, and it *names the id*, so "did I copy the right one?" is answerable
 * after the fact.
 */
export function useCopyId(id: string): { copied: boolean; copy: () => void } {
  const [copied, setCopied] = useState(false);
  // A second click inside the window restarts the countdown rather than letting
  // the first one's timer clear the mark early; and a chip unmounted mid-window
  // (a panel closing, a list re-filtering) must not wake up to set state.
  const resetRef = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(resetRef.current), []);

  function copy() {
    void (async () => {
      try {
        await navigator.clipboard.writeText(id);
      } catch {
        // Insecure origins and a denied permission both land here, and silence
        // would read as a copy that worked.
        toast.error("Unable to copy to clipboard.");
        return;
      }
      setCopied(true);
      toast.success(`Copied ${id}`);
      window.clearTimeout(resetRef.current);
      resetRef.current = window.setTimeout(() => setCopied(false), COPIED_RESET_MS);
    })();
  }

  return { copied, copy };
}
