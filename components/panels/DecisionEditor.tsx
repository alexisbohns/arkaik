"use client";

import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { StatusSelectItems } from "@/components/layout/StatusSelectItems";
import { PANEL_GUTTER } from "@/components/panels/PanelSection";
import { Shape, StatusPill } from "@/components/decisions/DecisionMarks";
import { cn } from "@/lib/utils";
import type { Edge, Node, NodeMetadata } from "@/lib/data/types";
import { type DecisionStatusId } from "@/lib/config/decision-statuses";
import { decisionStatusOf, decisionUpdatePatch } from "@/lib/utils/decision";
import { buildDecisionPanel, type DecisionPanelModel } from "@/lib/utils/decision-panel";

const AUTOSAVE_DELAY_MS = 350;

type OnUpdate = (id: string, patch: Partial<Omit<Node, "id" | "project_id">>) => Promise<void> | void;

interface DecisionEditorProps {
  node: Node;
  /** Absent on a read-only surface (the Changelog): the editor then shows facts and offers nothing. */
  onUpdate?: OnUpdate;
  /**
   * The panel's shared latest-metadata write base — see `NodeDetailPanel`,
   * which owns it.
   *
   * This editor owned it until Blocked by became a relation line: that line is
   * rendered by `RelationsGroup`, a sibling of this component rather than a
   * child of it, so the base had to rise to the one component that renders
   * both. All four writers below still read and write it exactly as before.
   */
  metadataRef: React.MutableRefObject<NodeMetadata | undefined>;
  /** The graph, for the decision's replacement line and its honest-state notes. */
  allNodes?: Node[];
  allEdges?: Edge[];
}

/**
 * One debounced metadata text field (context / consequences / decided_at).
 *
 * Mirrors `NodeFields`' title/description autosave: compare against a
 * last-saved ref rather than the prop directly, so a concurrent edit to a
 * DIFFERENT field (which also patches `metadata` wholesale) never fires a
 * duplicate save and never clobbers this one's pending save — the reschedule
 * on every keystroke is itself load-bearing, not incidental.
 *
 * Spreads `metadataRef.current` — the panel's shared latest-metadata base —
 * rather than `node.metadata` directly. See that ref's own comment in
 * `NodeDetailPanel` for why: `onUpdate` is not optimistic, so `node.metadata`
 * can still be stale while a sibling's save is in flight.
 */
function useDebouncedMetadataField(
  node: Node,
  key: "context" | "consequences" | "decided_at",
  metadataRef: React.MutableRefObject<NodeMetadata | undefined>,
  onUpdate: DecisionEditorProps["onUpdate"],
) {
  const stored = typeof node.metadata?.[key] === "string" ? (node.metadata?.[key] as string) : "";
  const [value, setValue] = useState(stored);
  const lastSavedRef = useRef(stored.trim());

  useEffect(() => {
    const trimmed = value.trim();
    if (trimmed === lastSavedRef.current) return;
    const timeout = setTimeout(() => {
      lastSavedRef.current = trimmed;
      const next: NodeMetadata = { ...(metadataRef.current ?? {}) };
      if (trimmed === "") delete next[key];
      else next[key] = trimmed;
      metadataRef.current = next;
      void onUpdate?.(node.id, { metadata: next });
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timeout);
  }, [value, key, node.id, metadataRef, onUpdate]);

  return [value, setValue] as const;
}

/**
 * The decision species' editing state: decision status (via the synced
 * `decisionUpdatePatch`, never a bare metadata write — see `lib/utils/decision.ts`),
 * and context/consequences/decided-on as debounced metadata fields — plus the
 * live panel model those values make, for the parts that draw them.
 *
 * A hook rather than a component because the Expressive panel places its
 * pieces in two different parents: the verdict inside the hero `NodeFields`
 * draws, the reasoning below it. Whoever calls it must remount per record
 * (keyed on the node id): the local state is seeded once.
 *
 * Without `onUpdate` (a read-only surface) every setter is absent, and the
 * pieces render facts with no controls.
 *
 * The supersedes/generates/impacts links spec §5 defines are not here: they
 * are relations, not fields, so they render in the Relations group — as four
 * of the grammar-derived relation lines `relationLinesFor("decision")`
 * produces. Blocked by went the same way.
 */
export function useDecisionEditor({ node, onUpdate, metadataRef, allNodes, allEdges }: DecisionEditorProps) {
  // Per-mount: the panel stack keeps hidden panels mounted, so two decisions can
  // be open at once and a hand-written id would give both their labels the same
  // target.
  const fieldId = useId();
  // Set-then-save, like NodeFields' status select: onUpdate is not optimistic
  // (it awaits the provider before node.status/node.metadata reflect a write),
  // so a value read straight from `decisionStatusOf(node)` would revert to the
  // pre-change status for the round-trip's duration. Local state is the
  // optimistic display; remounting by key is still what resets it when the
  // panel switches to a different decision.
  const [decisionStatus, setDecisionStatus] = useState<DecisionStatusId>(decisionStatusOf(node));

  const [context, setContext] = useDebouncedMetadataField(node, "context", metadataRef, onUpdate);
  const [consequences, setConsequences] = useDebouncedMetadataField(node, "consequences", metadataRef, onUpdate);
  const [decidedAt, setDecidedAt] = useDebouncedMetadataField(node, "decided_at", metadataRef, onUpdate);

  // One write path for a transition: decisionUpdatePatch bundles the metadata
  // write with the lifecycle sync so diffNodeUpdate derives both events. Its
  // metadata base is the shared ref (not `node.metadata`) for the same reason
  // the text fields use it — a status change during a pending text save must
  // not clobber it, and vice versa.
  function handleStatusChange(value: DecisionStatusId) {
    if (!onUpdate) return;
    setDecisionStatus(value);
    const patch = decisionUpdatePatch({ metadata: metadataRef.current }, value);
    metadataRef.current = patch.metadata;
    void onUpdate(node.id, patch);
  }

  const readOnly = !onUpdate;
  return {
    fieldId,
    // The live model: the optimistic status and the text as typed.
    model: buildDecisionPanel(node, {
      status: decisionStatus,
      decidedAt: decidedAt.trim(),
      context,
      consequences,
      allNodes,
      allEdges,
      readOnly,
    }),
    decidedAt,
    onStatusChange: readOnly ? undefined : handleStatusChange,
    onDecidedAtChange: readOnly ? undefined : setDecidedAt,
    onContextChange: readOnly ? undefined : setContext,
    onConsequencesChange: readOnly ? undefined : setConsequences,
  };
}

export type DecisionEditorState = ReturnType<typeof useDecisionEditor>;

/**
 * The decision editor on the Calm look: status and decided-on side by side,
 * then context and consequences as labelled textareas. Only where there is a
 * save path, as before the Expressive panel.
 */
export function DecisionEditor(props: DecisionEditorProps) {
  const { fieldId, model, decidedAt, onStatusChange, onDecidedAtChange, onContextChange, onConsequencesChange } =
    useDecisionEditor(props);

  return (
    <div className={cn(PANEL_GUTTER, "flex flex-col gap-5")}>
      {/* Where a decision *stands* and *when* it was taken, on one row at the
          top. They are the two facts a reader scans a decision for, they are
          both one control wide, and stacking them pushed "Decided on" below two
          four-row textareas — past the fold on a narrow panel. Two columns even
          on mobile: a select and a date input both hold their own at half a
          panel's width, and splitting them apart at a breakpoint would undo the
          pairing that is the point. */}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Decision status" htmlFor={`${fieldId}-status`}>
          <Select value={model.status} onValueChange={(v) => onStatusChange?.(v as DecisionStatusId)}>
            <SelectTrigger id={`${fieldId}-status`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <StatusSelectItems vocabulary="decision-status" />
            </SelectContent>
          </Select>
        </Field>
        <Field label="Decided on" htmlFor={`${fieldId}-decided-at`}>
          <Input
            id={`${fieldId}-decided-at`}
            type="date"
            value={decidedAt}
            onChange={(e) => onDecidedAtChange?.(e.target.value)}
          />
        </Field>
      </div>
      <Field label="Context — why" htmlFor={`${fieldId}-context`}>
        <Textarea
          id={`${fieldId}-context`}
          value={model.context}
          onChange={(e) => onContextChange?.(e.target.value)}
          placeholder="What made this decision necessary?"
          rows={4}
        />
      </Field>
      <Field label="Consequences — how" htmlFor={`${fieldId}-consequences`}>
        <Textarea
          id={`${fieldId}-consequences`}
          value={model.consequences}
          onChange={(e) => onConsequencesChange?.(e.target.value)}
          placeholder="What follows from it — trade-offs, obligations, follow-ups?"
          rows={4}
        />
      </Field>
    </div>
  );
}

/* ───────────────────────────── Expressive ───────────────────────────── */

/**
 * The verdict, as one sentence under the title in the hero: "This decision is
 * [Approved ▾] since [30/07/2026]" — the status an inline menu, the date an
 * inline field, both on the hero's own tint (app/m3/decisions.css re-tones
 * their fill). Read-only, the same sentence with the status as a pill and the
 * date in words. Under it, when the data disagrees with itself, a note says so.
 */
export function DecisionVerdict({ editor }: { editor: DecisionEditorState }) {
  const { model, fieldId, onStatusChange, onDecidedAtChange } = editor;
  const tone = { "--np-status-tone": `var(--dc-hue-${model.status})` } as CSSProperties;
  const dateId = `${fieldId}-decided`;
  return (
    <div className="dc-verdict" data-verdict="sentence" data-dc-status={model.status}>
      {onStatusChange && onDecidedAtChange ? (
        <p className="dc-sentence">
          <span>This decision is</span>
          <Select value={model.status} onValueChange={(v) => onStatusChange(v as DecisionStatusId)}>
            <SelectTrigger data-np-status="" data-compact="" aria-label="Decision status" className="dc-sentence-select" style={tone}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <StatusSelectItems vocabulary="decision-status" />
            </SelectContent>
          </Select>
          <span className="dc-decided dc-sentence-date" data-empty={model.decidedAt ? undefined : ""}>
            <label htmlFor={dateId} className="dc-decided-label">
              since
            </label>
            <input
              id={dateId}
              type="date"
              className="dc-decided-input"
              value={editor.decidedAt}
              onChange={(event) => onDecidedAtChange(event.target.value)}
            />
          </span>
        </p>
      ) : (
        <p className="dc-sentence" data-readonly="">
          This decision is <StatusPill status={model.status} />
          {model.decidedLabel ? <> since {model.decidedLabel}.</> : <>, with no decision date.</>}
        </p>
      )}
      <HonestNotes model={model} onStatusChange={onStatusChange} />
    </div>
  );
}

/**
 * The data disagreeing with itself, said plainly: a decision another one
 * replaced that is still on the road, or a superseded one nothing replaces.
 * The one fix that is a status change offers itself where there is a save path.
 */
function HonestNotes({
  model,
  onStatusChange,
}: {
  model: DecisionPanelModel;
  onStatusChange?: (status: DecisionStatusId) => void;
}) {
  if (!model.replacedButNotSuperseded && !model.supersededWithoutSuccessor) return null;
  return (
    <div className="dc-honest" role="note">
      {model.replacedButNotSuperseded && (
        <p>
          <strong>{model.supersededBy.map((n) => n.title || n.id).join(", ")}</strong> replaced this decision, but it is
          still marked <strong>{model.statusLabel.toLowerCase()}</strong>.
          {onStatusChange && (
            <button type="button" className="dc-honest-fix" onClick={() => onStatusChange("superseded")}>
              Mark superseded
            </button>
          )}
        </p>
      )}
      {model.supersededWithoutSuccessor && (
        <p>Marked superseded, but no decision replaces it yet. Link its successor under Relations.</p>
      )}
    </div>
  );
}

const REASONING = [
  { key: "context", word: "Why", name: "Context", mark: "cookie9", placeholder: "What made this decision necessary?" },
  { key: "consequences", word: "How", name: "Consequences", mark: "clover4", placeholder: "What follows from it — trade-offs, obligations, follow-ups?" },
] as const;

/**
 * Why and How, the decision's reasoning, drawn like its What (the description
 * under the hero): a headline word, its name, and a borderless field that
 * grows with what is written. Read-only, the prose itself — so a decision
 * opened from the Changelog still says why it was taken — or, with neither
 * half written, one honest line rather than two empty boxes.
 */
export function DecisionReasoning({ editor }: { editor: DecisionEditorState }) {
  const { model, fieldId } = editor;
  const values = { context: model.context, consequences: model.consequences };
  const setters = { context: editor.onContextChange, consequences: editor.onConsequencesChange };
  const readOnly = model.readOnly;

  if (readOnly && REASONING.every((half) => values[half.key].trim() === "")) {
    return (
      <div data-decision-editor className={PANEL_GUTTER}>
        <p className="dc-reasoning" data-reasoning="headline" data-none="">
          Why and how this was decided aren’t written down yet.
        </p>
      </div>
    );
  }
  return (
    <div data-decision-editor className={PANEL_GUTTER}>
      <div className="dc-reasoning" data-reasoning="headline" data-readonly={readOnly ? "" : undefined} data-dc-status={model.status}>
        {REASONING.map((half) => {
          const id = `${fieldId}-${half.key}`;
          const value = values[half.key];
          const set = setters[half.key];
          return (
            <div key={half.key} className="dc-reason" data-half={half.key} data-empty={value.trim() === "" ? "" : undefined}>
              <div className="dc-reason-head">
                <Shape name={half.mark} className="dc-reason-mark" />
                {set ? (
                  <label htmlFor={id} className="dc-reason-word">
                    {half.word}
                  </label>
                ) : (
                  <span className="dc-reason-word">{half.word}</span>
                )}
                <span className="dc-reason-name">{half.name}</span>
              </div>
              {set ? (
                <textarea
                  id={id}
                  aria-label={`${half.name} — ${half.word.toLowerCase()}`}
                  className="dc-reason-input"
                  value={value}
                  placeholder={half.placeholder}
                  rows={2}
                  onChange={(event) => set(event.target.value)}
                />
              ) : value.trim() ? (
                <p className="dc-reason-prose">{value}</p>
              ) : (
                <p className="dc-reason-prose" data-empty="">
                  Not written yet.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
