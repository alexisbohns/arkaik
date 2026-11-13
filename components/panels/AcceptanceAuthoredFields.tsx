"use client";

import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { Node } from "@/lib/data/types";
import type { ValueId } from "@arkaik/schema";
import { ExpressiveShape } from "@/components/arkademy/ExpressiveShape";
import { ValuePicker } from "@/components/values/ValuePicker";
import { usePanelPreferences } from "@/lib/hooks/usePanelPreferences";

interface AcceptanceAuthoredFieldsProps {
  node: Node;
  // No `allNodes` / `allEdges`: they were only ever the split dialog's anchor
  // count, and the dialog now lives above the panel — `ProjectPanels` mounts
  // one for the whole stack. Nothing authored here reads the graph.
  onUpdate: (id: string, patch: Partial<Omit<Node, "id" | "project_id">>) => Promise<void> | void;
}

const KEYWORD = /\b(Given|When|Then|And|But)\b/g;

/**
 * The Gherkin with its keywords lit, drawn under a transparent textarea that
 * does the typing. Same font, size and wrapping as the textarea, so every
 * character sits exactly over its twin.
 */
function LitGherkin({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(KEYWORD)) {
    const at = match.index ?? 0;
    parts.push(<Fragment key={`t${at}`}>{text.slice(last, at)}</Fragment>);
    parts.push(
      <b key={`k${at}`} className="np-kw">
        {match[0]}
      </b>,
    );
    last = at + match[0].length;
  }
  parts.push(<Fragment key="end">{text.slice(last)}</Fragment>);
  // A trailing newline in a textarea opens a line the mirror would otherwise drop.
  return (
    <>
      {parts}
      {"​"}
    </>
  );
}

const LINE_KEYWORD = /^(\s*)(Given|When|Then|And|But)\b/;

/**
 * The Gherkin as lines: one per step, its keyword in a column of its own. A
 * one-line "When …, Then …" is split on the keywords too, so it reads as two.
 */
function GherkinLines({ text }: { text: string }) {
  const lines = text
    .split(/\n|(?=\b(?:Given|When|Then|And|But)\b)/)
    .map((line) => line.trim().replace(/,$/, ""))
    .filter(Boolean);
  return (
    <>
      {lines.map((line, i) => {
        const match = line.match(LINE_KEYWORD);
        return (
          <span key={i} className="np-calm-gherkin-line">
            {match ? (
              <>
                <span className="np-calm-gherkin-kw">{match[2]}</span>
                <span>{line.slice(match[0].length).trim()}</span>
              </>
            ) : (
              line
            )}
          </span>
        );
      })}
    </>
  );
}

/**
 * What an acceptance itself says — the How and the Why, last in the intro
 * block.
 *
 * Expressive: two titled blocks, each with a small shape mark. The Gherkin sits in a tonal
 * well with its Given / When / Then lit up in the species ink as you type, so
 * the sentence's skeleton reads at a glance. The lighting is a mirror drawn
 * under a transparent textarea: the field stays a real textarea (caret,
 * selection, undo, IME), and the mirror is `aria-hidden`.
 *
 * Calm: two label-left rows; the Gherkin reads as one line per step until it is
 * clicked (or reached with the keyboard and Enter), then it is a textarea.
 *
 * Both looks share one draft and one debounced save, so switching looks never
 * drops a keystroke.
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
  const [gherkin, setGherkin] = useState(node.metadata?.gherkin ?? "");
  const nodeRef = useRef(node);
  useEffect(() => {
    nodeRef.current = node;
  }, [node]);
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

  function setValues(values: ValueId[]) {
    onUpdate(node.id, { metadata: { ...node.metadata, values } });
  }

  // Calm: label-left rows. The Gherkin reads as Given / When / Then lines and
  // turns into a textarea on click or Enter; Escape (or leaving it) returns to
  // the read view with focus back on it, without closing the panel.
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

  if (look === "calm") {
    return (
      <div className="np-calm-props">
        <div className="np-calm-prop np-calm-prop-top">
          <span className="np-calm-prop-label" id={`${fieldId}-how`}>
            How
          </span>
          <div className="np-calm-prop-value">
            {editing ? (
              <textarea
                ref={areaRef}
                id={`${fieldId}-gherkin`}
                aria-labelledby={`${fieldId}-how`}
                className="np-calm-textarea np-calm-textarea-grow"
                value={gherkin}
                onChange={(event) => setGherkin(event.target.value)}
                onBlur={() => setEditing(false)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    // Stopped here: the panel stack also listens for Escape.
                    event.preventDefault();
                    event.stopPropagation();
                    returnFocus.current = true;
                    setEditing(false);
                  }
                }}
                rows={2}
                placeholder="When I'm on …, Then …"
              />
            ) : (
              <button
                ref={readRef}
                type="button"
                className="np-calm-gherkin-read"
                aria-labelledby={`${fieldId}-how ${fieldId}-how-body`}
                aria-describedby={`${fieldId}-how-edit`}
                onClick={() => setEditing(true)}
              >
                <span id={`${fieldId}-how-body`} className="np-calm-gherkin-body">
                  {gherkin.trim() ? (
                    <GherkinLines text={gherkin} />
                  ) : (
                    <span className="np-calm-value-empty">Add a Given / When / Then…</span>
                  )}
                </span>
                <span id={`${fieldId}-how-edit`} className="sr-only">
                  Edit
                </span>
              </button>
            )}
          </div>
        </div>
        <div className="np-calm-prop np-calm-prop-top">
          <span className="np-calm-prop-label">Why</span>
          <div className="np-calm-prop-value">
            <div className="np-calm-values">
              <ValuePicker selected={node.metadata?.values ?? []} onChange={setValues} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div data-np-authored="lit" className="np-authored">
      <div className="np-authored-block">
        {/* A real label: this textarea is the acceptance's central field, and
            a screen reader must announce it by name (audit `shadcn-4`). */}
        <label htmlFor={`${fieldId}-gherkin`} className="np-authored-head">
          <span className="np-authored-mark" aria-hidden="true">
            <ExpressiveShape shape="clover4" className="size-full" />
          </span>
          <span className="np-authored-title">How</span>
          <span className="np-authored-sub">one Given / When / Then</span>
        </label>
        <div className="np-gherkin-field" data-lit>
          <div className="np-gherkin-mirror" aria-hidden="true">
            <LitGherkin text={gherkin} />
          </div>
          <textarea
            id={`${fieldId}-gherkin`}
            value={gherkin}
            onChange={(event) => setGherkin(event.target.value)}
            rows={3}
            placeholder="When I'm on …, Then …"
            className="np-gherkin-input"
          />
        </div>
      </div>
      <div className="np-authored-block">
        {/* Not a `<label>`: `ValuePicker` is a combobox that names itself, so
            there is no single control a label here should point at. */}
        <span className="np-authored-head">
          <span className="np-authored-mark" aria-hidden="true">
            <ExpressiveShape shape="flower" className="size-full" />
          </span>
          <span className="np-authored-title">Why</span>
          <span className="np-authored-sub">the values it serves</span>
        </span>
        <div className="np-values">
          <ValuePicker selected={node.metadata?.values ?? []} onChange={setValues} />
        </div>
      </div>
    </div>
  );
}
