"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Node } from "@/lib/data/types";
import type { ValueId } from "@arkaik/schema";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { ValuePicker } from "@/components/values/ValuePicker";

interface AcceptanceAuthoredFieldsProps {
  node: Node;
  // No `allNodes` / `allEdges`: they were only ever the split dialog's anchor
  // count, and the dialog now lives above the panel — `ProjectPanels` mounts
  // one for the whole stack. Nothing authored here reads the graph.
  onUpdate: (id: string, patch: Partial<Omit<Node, "id" | "project_id">>) => Promise<void> | void;
  // No `onNavigate`: the anchor links that used it moved out with `CoversSection`,
  // and nothing authored here has anywhere to navigate to.
  //
  // No `intake` either: Split was the only gesture this component offered, and
  // it is now an item in the panel header's menu.
}

/**
 * What an acceptance itself says — the How and the Why, in the intro block
 * after Blocked by.
 *
 * Passed to `NodeFields` as the `authored` slot, so it renders into that
 * component's gutter and `gap-5` column: the fields below are the column's own
 * items and must not be wrapped in a gutter of their own.
 */
export function AcceptanceAuthoredFields({ node, onUpdate }: AcceptanceAuthoredFieldsProps) {
  // Per-mount: the panel stack keeps hidden panels mounted, so two acceptance
  // panels can share a document and a hand-written id would leave the second
  // one's label pointing at the first one's control.
  const fieldId = useId();
  const [gherkin, setGherkin] = useState(node.metadata?.gherkin ?? "");
  const nodeRef = useRef(node);
  useEffect(() => { nodeRef.current = node; }, [node]);
  // Debounce-save gherkin. The effect reschedules on every keystroke and clears
  // its timer on rechange/unmount, so the save closure is always fresh. It reads
  // the LATEST node via nodeRef at fire time, so a concurrent values/status edit
  // isn't clobbered by the provider's shallow metadata merge (mirrors NodeFields).
  useEffect(() => {
    if (gherkin === (nodeRef.current.metadata?.gherkin ?? "")) return;
    const t = setTimeout(() => {
      onUpdate(nodeRef.current.id, { metadata: { ...nodeRef.current.metadata, gherkin } });
    }, 350);
    return () => clearTimeout(t);
  }, [gherkin, onUpdate]);

  function patchMetadata(next: Record<string, unknown>) {
    onUpdate(node.id, { metadata: { ...node.metadata, ...next } });
  }

  return (
    <>
      {/* The `htmlFor` here is audit `shadcn-4`'s headline case: this textarea
          had no id, no aria-label and an unassociated `<span>` over it, so a
          screen reader announced the acceptance's central field as an unnamed
          edit box. */}
      <Field label="Gherkin — the How (one Given/When/Then)" htmlFor={`${fieldId}-gherkin`}>
        <Textarea
          id={`${fieldId}-gherkin`}
          value={gherkin}
          onChange={(e) => setGherkin(e.target.value)}
          rows={3}
          placeholder="When I'm on …, Then …"
        />
      </Field>

      {/* No `htmlFor` on the Field below: `ValuePicker` is a combobox that
          names itself, so there is no single control a `<label>` here should
          point at. This comment used to enumerate "these three" — a platform
          tab strip and a Decompose button stood alongside; the strip is the
          Platforms group's now (`AcceptancePlatformsSection`) and Split is an
          item in the panel header's menu. */}
      <Field label="Values — the Why">
        <ValuePicker selected={node.metadata?.values ?? []} onChange={(values: ValueId[]) => patchMetadata({ values })} />
      </Field>
    </>
  );
}
