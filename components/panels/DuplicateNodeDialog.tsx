"use client";

import { useId, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SPECIES } from "@/lib/config/species";
import type { Node } from "@/lib/data/types";
import { generateNodeId, SPECIES_PREFIXES } from "@/lib/utils/id";

/**
 * Name the copy before anything is written.
 *
 * **Duplicate is the only gesture in the app that mints an id the reader never
 * asked for.** A node's id comes from its title once and never changes; it then
 * lives in urls, chips, exported bundles and Lab Notes. Creating the copy on
 * click would take that permanent decision silently, at the exact moment it is
 * cheapest to take deliberately — so the click opens this instead.
 *
 * The name starts **empty**, with the original's title as the placeholder, and
 * the confirm is disabled until something is typed. Deliberately not prefilled
 * with `… (copy)` and deliberately not falling back to the placeholder on
 * submit: a default that can be confirmed by reflex is the silent mint again,
 * one dialog later. The placeholder is there to say what is being copied, not
 * to offer a value.
 *
 * The id is shown as it will be created — the one place in the app an id is
 * visible before its record exists — and follows the name until the reader
 * touches it, after which it is theirs and stops following. A derived id cannot
 * be invalid, so the two checks below only ever bite on an override.
 */

interface DuplicateNodeDialogProps {
  /** The node being copied. `null` closes the dialog and resets its fields. */
  node: Node | null;
  onOpenChange: (open: boolean) => void;
  /**
   * Every id already in use, for both the mint and the collision check.
   *
   * A `Set`, not an `Iterable`. It was `nodesById.keys()`, and that is a
   * one-shot iterator: the caller re-creates it only when *it* renders, while
   * this dialog re-renders on every keystroke, so from the second keystroke on
   * the set built from it was empty and the collision check silently passed
   * every id in the project. Caught on screen — `AC-public-map-undeletable` was
   * accepted as a free id.
   */
  existingIds: ReadonlySet<string>;
  onSubmit: (node: Node, named: { id: string; title: string }) => Promise<void> | void;
}

export function DuplicateNodeDialog({
  node,
  onOpenChange,
  existingIds,
  onSubmit,
}: DuplicateNodeDialogProps) {
  // Per-mount, like every other panel-side form: the stack keeps hidden panels
  // mounted, so a hand-written id would be a second "Name" label in the same
  // document pointing at the first one's input.
  const fieldId = useId();
  const [title, setTitle] = useState("");
  // `null` while the id still follows the name. A string — including an empty
  // one — means the reader has taken it over, which is why this is not just
  // `idOverride !== ""`: clearing the field is an override to an empty id, and
  // it must be refused rather than silently reverting to the derived one.
  const [idOverride, setIdOverride] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const trimmedTitle = title.trim();
  const derivedId = node && trimmedTitle ? generateNodeId(node.species, trimmedTitle, existingIds) : "";
  const id = idOverride ?? derivedId;

  const prefix = node ? SPECIES_PREFIXES[node.species] : "";
  const speciesLabel = node ? SPECIES.find((s) => s.id === node.species)?.label ?? node.species : "";

  const idError =
    idOverride === null || !trimmedTitle
      ? null
      : !id.startsWith(prefix)
        ? // No article: "A acceptance id" and "A api-endpoint id" are both
          // wrong, and this sentence has to be right for all six species.
          `${speciesLabel} ids start with ${prefix}`
        : existingIds.has(id)
          ? `${id} is already in use`
          : null;

  const canSubmit = Boolean(node) && trimmedTitle.length > 0 && !idError && !busy;

  function close(open: boolean) {
    if (busy) return;
    onOpenChange(open);
    if (!open) {
      setTitle("");
      setIdOverride(null);
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit || !node) return;
    setBusy(true);
    try {
      await onSubmit(node, { id, title: trimmedTitle });
      close(false);
    } finally {
      // Not a `catch`: the caller reports its own failures and resolves either
      // way, so there is nothing to swallow here — but the dialog must not be
      // left stuck busy if it ever starts rejecting.
      setBusy(false);
    }
  }

  return (
    <Dialog open={node !== null} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Duplicate {speciesLabel.toLowerCase()}</DialogTitle>
          <DialogDescription>
            The copy carries everything this record says about itself — its status, its notes and
            its evidence. Give it its own name.
          </DialogDescription>
        </DialogHeader>
        <form id="duplicate-node-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field label="Name" htmlFor={`${fieldId}-title`}>
            <Input
              id={`${fieldId}-title`}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={node?.title ?? ""}
              disabled={busy}
              autoFocus
            />
          </Field>
          <Field
            label="Id"
            htmlFor={`${fieldId}-id`}
            hint={
              idError ? (
                <span className="text-destructive">{idError}</span>
              ) : idOverride === null ? (
                "Follows the name. Type here to choose it yourself — an id never changes once created."
              ) : (
                "Yours now — it no longer follows the name."
              )
            }
          >
            <Input
              id={`${fieldId}-id`}
              value={id}
              onChange={(event) => setIdOverride(event.target.value)}
              placeholder={prefix}
              disabled={busy || !trimmedTitle}
              aria-invalid={idError !== null}
              className="font-mono text-xs"
            />
          </Field>
        </form>
        <DialogFooter>
          <Button variant="outline" type="button" onClick={() => close(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="duplicate-node-form" disabled={!canSubmit}>
            Duplicate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
