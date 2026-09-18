"use client";

import { useEffect, useId, useRef, useState } from "react";
import { SplitIcon } from "lucide-react";
import { toast } from "sonner";
import type { Node, Edge } from "@/lib/data/types";
import type { ValueId } from "@arkaik/schema";
import type { AcceptanceIntake } from "@/lib/hooks/useAcceptanceIntake";
import { coveredAnchorsOf } from "@/lib/utils/where-used";
import { SplitAcceptanceDialog } from "@/components/panels/SplitAcceptanceDialog";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { ValuePicker } from "@/components/values/ValuePicker";

interface AcceptanceAuthoredFieldsProps {
  node: Node;
  /**
   * Only for the split dialog's anchor count — the sentence it writes says how
   * many nodes the copies will cover, and a dialog told nothing would quietly
   * drop a true clause about the reader's own graph.
   */
  allNodes: Node[];
  allEdges: Edge[];
  onUpdate: (id: string, patch: Partial<Omit<Node, "id" | "project_id">>) => Promise<void> | void;
  // No `onNavigate`: the anchor links that used it moved out with `CoversSection`,
  // and nothing authored here has anywhere to navigate to.
  /**
   * The decompose gestures — attach, detach, create-and-attach, split.
   *
   * Absent on a surface whose panels are read-only, and then the Decompose
   * button is absent with it. Present, and an idea filed with no anchor can be
   * turned into several that have them.
   */
  intake?: AcceptanceIntake;
}

/**
 * What an acceptance itself says — the How and the Why, in the intro block
 * after Blocked by.
 *
 * Passed to `NodeFields` as the `authored` slot, so it renders into that
 * component's gutter and `gap-5` column: the fields below are the column's own
 * items and must not be wrapped in a gutter of their own.
 */
export function AcceptanceAuthoredFields({ node, allNodes, allEdges, onUpdate, intake }: AcceptanceAuthoredFieldsProps) {
  // Per-mount: the panel stack keeps hidden panels mounted, so two acceptance
  // panels can share a document and a hand-written id would leave the second
  // one's label pointing at the first one's control.
  const fieldId = useId();
  const [gherkin, setGherkin] = useState(node.metadata?.gherkin ?? "");
  const [splitOpen, setSplitOpen] = useState(false);
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

  // Its own walk rather than a count threaded down from
  // `AcceptanceMembershipField`, which derives the same thing for its hint: two
  // cheap filters over the same edges beat a prop two components must keep in
  // step. `coveredAnchorsOf` is the shared helper either way, so there is one
  // definition of what "covered" means.
  const anchorCount = coveredAnchorsOf(node, allNodes, allEdges).length;

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

      {/* No `htmlFor` on the Fields below — a combobox that names itself, and
          a button that is only there with `intake`: neither is a control a
          `<label>` here should point at. It enumerated "these three" while the
          platform tab strip sat between them, and the count was already wrong
          for a read-only surface before that; the strip is now the Platforms
          group's — see `AcceptancePlatformsSection`. */}
      <Field label="Values — the Why">
        <ValuePicker selected={node.metadata?.values ?? []} onChange={(values: ValueId[]) => patchMetadata({ values })} />
      </Field>

      {intake && (
        <Field
          label="Decompose"
          hint="One acceptance states one thing. Split when the idea has grown into several."
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => setSplitOpen(true)}
          >
            <SplitIcon className="size-4" /> Split into several…
          </Button>
          <SplitAcceptanceDialog
            open={splitOpen}
            onOpenChange={setSplitOpen}
            title={node.title}
            anchorCount={anchorCount}
            // Not `run`: the dialog has to know whether the write landed, so
            // that a failure leaves the rows on screen instead of discarding
            // them. Reported here all the same, then rethrown.
            onSubmit={async (titles) => {
              try {
                await intake.split(node, titles);
              } catch (err) {
                toast.error("Couldn't split the acceptance.");
                console.error(err);
                throw err;
              }
            }}
          />
        </Field>
      )}
    </>
  );
}
