"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { PencilIcon } from "lucide-react";
import type { Node } from "@/lib/data/types";
import type { ValueId } from "@arkaik/schema";
import { ExpressiveShape } from "@/components/arkademy/ExpressiveShape";
import { ValuePicker } from "@/components/values/ValuePicker";
import { ValueBadge } from "@/components/values/ValueBadge";
import { usePanelPreferences } from "@/lib/hooks/usePanelPreferences";

interface AcceptanceAuthoredFieldsProps {
  node: Node;
  /** No save path (the Changelog, Design): the Gherkin and the values are shown, never offered for editing. */
  onUpdate?: (id: string, patch: Partial<Omit<Node, "id" | "project_id">>) => Promise<void> | void;
  // No `allNodes` / `allEdges`: they were only ever the split dialog's anchor
  // count, and the dialog now lives above the panel — `ProjectPanels` mounts
  // one for the whole stack. Nothing authored here reads the graph.
}

const STEP = /\b(Given|When|Then|And|But)\b/;

/** One step per line: "When x, Then y" is two. A line with no keyword is a step with none. */
export function gherkinSteps(text: string): { kw: string; body: string }[] {
  return text
    .split(/\n|(?=\b(?:Given|When|Then|And|But)\b)/)
    .map((line) => line.trim().replace(/,$/, ""))
    .filter(Boolean)
    .map((line) => {
      const match = line.match(new RegExp(`^${STEP.source}`));
      return match ? { kw: match[1], body: line.slice(match[0].length).trim() } : { kw: "", body: line };
    });
}

/** The Gherkin as keyword stickers, one per step; the Then in bold. */
function Steps({ text }: { text: string }) {
  return (
    <span className="kap-au-steps">
      {gherkinSteps(text).map((step, i) => (
        <span key={i} className="kap-au-step" data-kw={step.kw || undefined}>
          <b>{step.kw || "·"}</b>
          <span>{step.body}</span>
        </span>
      ))}
    </span>
  );
}

function Head({ shape, title, sub, htmlFor, id }: { shape: "clover4" | "flower"; title: string; sub: string; htmlFor?: string; id: string }) {
  const body = (
    <>
      <span className="kap-au-mark" aria-hidden="true">
        <ExpressiveShape shape={shape} className="size-full" />
      </span>
      <span className="kap-au-title">{title}</span>
      <span className="kap-au-sub">{sub}</span>
    </>
  );
  return htmlFor ? (
    // A real label while the textarea is open: this is the acceptance's central
    // field, and a screen reader must announce it by name (audit `shadcn-4`).
    <label id={id} htmlFor={htmlFor} className="kap-au-head">
      {body}
    </label>
  ) : (
    <span id={id} className="kap-au-head">
      {body}
    </span>
  );
}

function ReadValues({ values }: { values: ValueId[] }) {
  if (values.length === 0) return <p className="kap-au-none">No values claimed yet.</p>;
  return (
    <ul className="kap-au-values" aria-label="Values this promise serves">
      {values.map((value) => (
        <li key={value}>
          <ValueBadge valueId={value} />
        </li>
      ))}
    </ul>
  );
}

/**
 * What an acceptance itself says — the How and the Why, last in the intro
 * block, on both looks.
 *
 * The Gherkin reads as one line per step, its keyword a sticker in a column of
 * its own and the Then in bold. With a save path it is a button: a click (or
 * Enter) opens the textarea, Escape or leaving it closes it again without
 * closing the panel — and an empty Gherkin opens straight to the textarea, so
 * there is never a dead "add" button. Without a save path (the Changelog) the
 * same reading is plain text and the values are badges: nothing dead, and
 * nothing missing.
 *
 * One draft, one debounced save (350 ms, reading the LATEST node through a ref
 * at fire time so a concurrent status or values edit is not clobbered).
 *
 * Passed to `NodeFields` as the `authored` slot, so it renders into that
 * component's gutter and `gap-5` column and must not carry a gutter of its own.
 */
export function AcceptanceAuthoredFields({ node, onUpdate }: AcceptanceAuthoredFieldsProps) {
  // Per-mount: the panel stack keeps hidden panels mounted, so two acceptance
  // panels can share a document and a hand-written id would leave the second
  // one's label pointing at the first one's control.
  const fieldId = useId();
  const { look } = usePanelPreferences();
  const readOnly = !onUpdate;
  const [draft, setDraft] = useState(node.metadata?.gherkin ?? "");
  const nodeRef = useRef(node);
  useEffect(() => {
    nodeRef.current = node;
  }, [node]);
  // Debounce-save the Gherkin. The effect reschedules on every keystroke and
  // clears its timer on rechange/unmount, so the save closure is always fresh.
  // It reads the LATEST node via nodeRef at fire time, so a concurrent
  // values/status edit isn't clobbered by the provider's shallow metadata merge
  // (mirrors NodeFields).
  useEffect(() => {
    if (!onUpdate) return;
    if (draft === (nodeRef.current.metadata?.gherkin ?? "")) return;
    const t = setTimeout(() => {
      onUpdate(nodeRef.current.id, { metadata: { ...nodeRef.current.metadata, gherkin: draft } });
    }, 350);
    return () => clearTimeout(t);
  }, [draft, onUpdate]);

  function setValues(values: ValueId[]) {
    onUpdate?.(node.id, { metadata: { ...node.metadata, values } });
  }

  const [editing, setEditing] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const readRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  useEffect(() => {
    if (editing) {
      const el = areaRef.current;
      el?.focus();
      el?.setSelectionRange(el.value.length, el.value.length);
    } else if (returnFocus.current) {
      returnFocus.current = false;
      readRef.current?.focus();
    }
  }, [editing]);

  // Read-only shows what is committed; editable shows the draft.
  const gherkin = readOnly ? (node.metadata?.gherkin ?? "") : draft;
  const values = (node.metadata?.values ?? []) as ValueId[];
  const empty = gherkin.trim() === "";
  const open = !readOnly && (editing || empty);

  const reading: ReactNode = empty ? (
    <p className="kap-au-none">{readOnly ? "No Given / When / Then written." : "Add a Given / When / Then…"}</p>
  ) : (
    <Steps text={gherkin} />
  );

  return (
    <div className="kap-scope kap-au" data-readonly={readOnly ? "" : undefined}>
      <div className="kap-au-block" data-block="how">
        <Head shape="clover4" title="How" sub="one Given / When / Then" htmlFor={open ? `${fieldId}-gherkin` : undefined} id={`${fieldId}-how`} />
        {open ? (
          <textarea
            ref={areaRef}
            id={`${fieldId}-gherkin`}
            className="kap-au-area"
            value={gherkin}
            rows={4}
            placeholder="When I'm on …, Then …"
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => setEditing(false)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && !empty) {
                // Stopped here: the panel stack also listens for Escape.
                event.preventDefault();
                event.stopPropagation();
                returnFocus.current = true;
                setEditing(false);
              }
            }}
          />
        ) : readOnly ? (
          <div className="kap-au-read">{reading}</div>
        ) : (
          <button
            ref={readRef}
            type="button"
            className="kap-au-read kap-au-editable"
            aria-labelledby={`${fieldId}-how ${fieldId}-how-body`}
            aria-describedby={`${fieldId}-how-edit`}
            onClick={() => setEditing(true)}
          >
            <span id={`${fieldId}-how-body`} className="kap-au-body">
              {reading}
            </span>
            <span className="kap-au-pencil" aria-hidden="true">
              <PencilIcon />
            </span>
            <span id={`${fieldId}-how-edit`} className="sr-only">
              Edit
            </span>
          </button>
        )}
      </div>
      <div className="kap-au-block" data-block="why">
        {/* Not a `<label>`: `ValuePicker` is a combobox that names itself, so
            there is no single control a label here should point at. */}
        <Head shape="flower" title="Why" sub="the values it serves" id={`${fieldId}-why`} />
        {readOnly ? (
          <ReadValues values={values} />
        ) : (
          <div className={look === "calm" ? "np-calm-values" : "np-values"}>
            <ValuePicker selected={values} onChange={setValues} />
          </div>
        )}
      </div>
    </div>
  );
}
