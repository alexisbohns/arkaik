"use client";

import { useEffect, useRef } from "react";

/**
 * Seed a dialog's form state on the **closed → open transition only**.
 *
 * The obvious spelling — `useEffect(() => { if (open) seed(value) }, [open,
 * value])` — is wrong in a way that is easy to miss and hard to see in use: it
 * also fires whenever `value` changes *while the dialog is already open*, and
 * silently replaces whatever the user had picked. That is reachable here rather
 * than theoretical, because every caller seeds from the product scope and
 * `useEffectiveProduct` resolves against a bundle `useProject` loads in an
 * effect — so `scope.productId` is `null` on the first render and arrives a beat
 * later. A dialog opened inside that window would have its picker yanked out
 * from under the user.
 *
 * The latch is a ref rather than state on purpose: it must not cause a render,
 * and it must be updated on *every* run of the effect, including the ones this
 * hook deliberately does nothing on.
 *
 * `seed` is called rather than `setState` handed in, so the caller can run the
 * same constraint logic its onChange handler runs — seeding a product without
 * pruning the platforms it forbids would let the form submit the exact
 * containment violation the picker exists to prevent.
 */
export function useSeedOnOpen<T>(open: boolean, value: T, seed: (value: T) => void): void {
  const wasOpen = useRef(false);
  // The seed callback is read through a ref so that a caller which rebuilds it
  // every render does not turn this into an every-render effect. Only `open` is
  // allowed to decide when it runs.
  const seedRef = useRef(seed);
  seedRef.current = seed;

  useEffect(() => {
    const opening = open && !wasOpen.current;
    wasOpen.current = open;
    if (opening) seedRef.current(value);
  }, [open, value]);
}
