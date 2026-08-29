"use client";

import { useCallback, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useProjectPanels, NODE_PANEL_PARAM } from "@/lib/hooks/useProjectPanels";
import { useQueryWriter } from "@/lib/hooks/useQueryWriter";

interface AddressedBottomPanelOptions {
  /**
   * The query params this address is written in — the first is the one whose
   * presence means "a panel is addressed"; the rest ride along and are deleted
   * with it. `["criterion", "csurface"]`, `["cell"]`.
   */
  params: readonly [string, ...string[]];
  /** The stack key the current address names, or `null` for no address. */
  addressed: string | null;
  /** Open the addressed panel at depth 0. Must be stable. */
  open: () => void;
  /**
   * The key of the entry at the *bottom* of the stack when it is a panel of
   * this kind, or `null` when it is anything else (or the stack is empty).
   */
  openKey: string | null;
}

/**
 * Keep a page-owned panel address and the bottom of the panel stack in step.
 *
 * The stack has exactly one address and it is `?node=`. Panels that are not
 * locations in the graph — a criterion, a matrix cell — are addressed by the
 * page that opens them, so a link to one survives a reload and a Back. This is
 * that sync, and it is shared because the hard part is not the happy path.
 *
 * The hard part is one question the URL alone cannot answer: the panel is gone
 * and the param still names it — was it *closed*, or was it *wiped*?
 *
 * `reconcileArrival`'s rule is that a missing `?node=` closes the **whole**
 * stack, so opening a linked node out of the panel and then pressing Back — or
 * closing that node panel, which republishes an empty address — takes this
 * panel down with it. That is pre-existing behaviour the Raw panel has had
 * since it landed; putting the panel back is this hook's job. It comes back
 * **remounted**, so whatever the reader had scrolled to inside it is lost.
 *
 * The two cases land in the identical state — no panel, a live param — and
 * differ only in whether the *node address* moved on the same pass.
 * `lastAddress` is that discriminator; `seen` keeps the very first pass (and
 * React's StrictMode double-invoke, which repeats it with the address already
 * recorded) from reading a panel that has not mounted yet as a panel the reader
 * closed.
 *
 * Extracted from the old single Quality page when it split into Matrix and
 * Findings. Two copies of this reasoning would have been two chances to lose
 * it.
 */
export function useAddressedBottomPanel({
  params,
  addressed,
  open,
  openKey,
}: AddressedBottomPanelOptions): { clear: () => void } {
  const searchParams = useSearchParams();
  const { entries } = useProjectPanels();
  // The page's own writer. The same hook the filter bar writes through, which
  // is the whole reason two writers can share this URL: it reads the live query
  // at call time rather than a closed-over snapshot.
  const writeQuery = useQueryWriter();

  const addressParam = searchParams.get(NODE_PANEL_PARAM);
  const stackDepth = entries.length;

  // Stable across renders so the effect below does not re-run on the identity
  // of a `readonly string[]` literal.
  const paramKey = params.join(",");
  const clear = useCallback(() => {
    writeQuery((query) => {
      for (const param of paramKey.split(",")) query.delete(param);
    });
  }, [paramKey, writeQuery]);

  const lastAddress = useRef<string | null | undefined>(undefined);
  const seen = useRef<string | null>(null);

  useEffect(() => {
    const addressMoved = lastAddress.current !== addressParam;
    lastAddress.current = addressParam;

    if (!addressed) {
      seen.current = null;
      return;
    }

    if (openKey === addressed) {
      // From here on a disappearance is meaningful: we know it was open.
      seen.current = addressed;
      return;
    }

    // A *different* panel of the same kind sits at the bottom. That is the one
    // frame between a click opening the new panel and the query write landing,
    // and the stack is the fresher of the two. Acting on the stale URL here
    // would reopen the panel the reader just navigated away from.
    if (openKey !== null) return;

    // Restored only into an *empty* stack. A stack with something else at the
    // bottom means somebody else owns depth 0 — a finding's linked node opened
    // from the board, which replaced this panel on purpose, or a node restored
    // from a `?node=` that arrived alongside this address on a cold load.
    // Opening at depth 0 truncates, so restoring over either would destroy the
    // panel the reader is actually looking at.
    if (stackDepth === 0 && (addressMoved || seen.current !== addressed)) {
      open();
      return;
    }

    // Nothing wiped it and nothing else took its slot, so the reader closed it.
    // The address goes with it — left behind, the branch above would faithfully
    // reopen the panel on the next pass and the close button would do nothing.
    if (seen.current === addressed) {
      seen.current = null;
      clear();
    }
  }, [addressParam, addressed, clear, open, openKey, stackDepth]);

  return { clear };
}
