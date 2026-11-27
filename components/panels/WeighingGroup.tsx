"use client";

import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { toast } from "sonner";
import {
  CONFIDENCE_ANCHORS,
  CONFIDENCE_LEVELS,
  WEIGHING_ASSESSMENT_RECORDED,
  WEIGHING_LEVELS,
  buildWeighingContext,
  weighPromise,
  weighingScaleOf,
  type EffectiveCell,
  type PromiseWeighing,
  type ValueId,
  type WeighingCriterion,
  type WeighingScale,
} from "@arkaik/schema";

import { PanelGroup } from "@/components/panels/PanelGroup";
import { PANEL_GUTTER } from "@/components/panels/PanelSection";
import { FlagSentences, GuessTag, Meter, fmt, pct, signed, whoOf } from "@/components/panels/weighing-marks";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ValueIcon } from "@/components/values/ValueBadge";
import type { Node } from "@/lib/data/types";
import { dynaPuff } from "@/lib/font-display";
import { useProjectId } from "@/lib/hooks/useProjectId";
import { useWeighing } from "@/lib/hooks/useWeighing";
import { assessmentFieldsFor, evidenceChanged, intentOf, type RowIntent } from "@/lib/utils/weighing-input";

/**
 * An acceptance's weight: a signed level (−3 to +3) for each element of value it
 * touches, how sure the scorer is, and why — with what that adds up to
 * (docs/rfcs/weighing.md).
 *
 * **Drawn as a ledger.** What it adds up to sits on top — serves and costs as
 * two bars, never netted, with the share that rests on guesses and the audit's
 * finds as sentences — then one line per element: its name and a seven-stop
 * scale inline. A line opens on a tap to its reasons: the element's question,
 * who scored it and how sure, the evidence. Every part carries a
 * `data-weighing-*` hook, so a stylesheet and the tests have something to hold
 * on to. Read-only (no save path), the same levels are drawn static, with no
 * control: nothing dead.
 *
 * What this file owns is the behaviour:
 *
 * - The elements the author *claimed* come first, in claim order, then every
 *   other element somebody has scored that is worth a look; the rest fold, and
 *   the unscored ones wait behind "Add an element".
 * - A cell nobody has scored reads at its **seeded** level and says so: every
 *   claimed value is guessed at +1 (within the product), never a score —
 *   hatched, never solid. Choosing a level writes the first human assessment
 *   and replaces the guess — at confidence 1 ("inferred from the promise's own
 *   text") unless a person says otherwise, because nobody picking a level on a
 *   form means "I guessed".
 * - A cell shows its **effective** level, who scored it, whether it has gone
 *   **stale** (the promise's title, Gherkin or values changed since), and — when
 *   a human and an agent disagree by two or more — that it wants a review. A
 *   human's level wins; an agent's rides beside it.
 * - **A level means what the element's own ladder says** (the reach ruler,
 *   `value-contribution@2`): +1 within the product, +2 across its domain, +3
 *   life-wide, worded per element. Each stop carries its rung as a tooltip, and
 *   the chosen level's rung shows under the line — a person labelling a cell
 *   reads the same words an agent scored against. A level a probabilistic
 *   scorer was unsure of carries a **range** marker.
 *
 * Every write is one `weighing.assessment.recorded` through `useWeighing`'s
 * `record` — the same gate an agent's `assess` goes through. A refused write
 * (the gate's reasons) is a toast, and the list re-reads either way, so the
 * controls never show a level the journal does not hold.
 *
 * **A write is a merge, and writes to one row go one at a time.** The `cell` a
 * handler closes over is the last render's, so two quick gestures on a row (type
 * evidence, click a confidence — the click blurs the box first; or click +3, then
 * a confidence before the refetch) would each rebuild the row from the same stale
 * cell and the later one would put the earlier one's fields back. So each row
 * remembers what it last said (`lastSent`), `assessmentFieldsFor` merges
 * cell < last said < this gesture (`lib/utils/weighing-input.ts`, tested), the
 * evidence is read off the box itself, and a row's writes are chained so each is
 * computed after the one before settled. Nothing is disabled to get there.
 */

interface WeighingGroupProps {
  node: Node;
  /** No save path: show the weight, offer no controls. */
  readOnly?: boolean;
}

// A bare "2" says little: each option carries its anchor as a tooltip.
const CONFIDENCE_OPTIONS = CONFIDENCE_LEVELS.map((level) => ({ id: String(level), label: String(level), title: CONFIDENCE_ANCHORS[level] }));

/** What a level means for one element: its own ladder's rung, else the scale's words. */
const rungOf = (criterion: WeighingCriterion, scale: WeighingScale, level: number): string | undefined =>
  criterion.anchors?.[String(level)] ?? scale.anchors[String(level)];

/** Why a cell is stale, in words: "re-read the promise" and "re-score on the new ruler" are different asks. */
function staleWords(cell: EffectiveCell): string {
  const subject = cell.stale_by?.includes("subject") ?? false;
  const ruler = cell.stale_by?.includes("ruler") ?? false;
  if (subject && ruler) return "stale: the promise and the ruler changed since this was scored";
  if (ruler) return "stale: scored on the old ruler, before levels meant reach";
  return "stale: the promise changed since this was scored";
}

function scorerLabel(cell: EffectiveCell): string {
  if (cell.source === "seed") return "A guess: a claimed value starts at +1, within the product";
  const model = typeof cell.scorer.model === "string" ? ` (${cell.scorer.model})` : "";
  return `${cell.scorer.kind === "human" ? "A person" : "An agent"}: ${cell.scorer.id}${model}`;
}

const whoWords = (cell: EffectiveCell) => (cell.scorer.kind === "human" ? "a person" : "an agent");

interface Row {
  criterion: WeighingCriterion;
  cell: EffectiveCell | undefined;
}

const labelOf = (row: Row) => row.criterion.name ?? row.criterion.id;

/** A level scored on the old ruler meant something else: never put the new rung's words in that scorer's mouth. */
const rungFor = (row: Row, scale: WeighingScale) =>
  row.cell === undefined || row.cell.stale_by?.includes("ruler") ? undefined : rungOf(row.criterion, scale, row.cell.level);

/** An element is worth a look first when it is claimed, unscored, stale, or two readers differ. */
const worthALook = (row: Row) => row.cell === undefined || row.cell.claimed || row.cell.review || row.cell.stale;

function useWeighingEditor(node: Node) {
  const projectId = useProjectId();
  const { section, record } = useWeighing(projectId);
  const ctx = useMemo(() => buildWeighingContext(section), [section]);
  const weighed = useMemo(() => (ctx === undefined ? undefined : weighPromise(node, ctx)), [ctx, node]);
  // Elements the person has opened a blank row for; nothing is written until a level is chosen.
  const [extra, setExtra] = useState<string[]>([]);
  // Rows with a write queued or in flight — per row, never one slot for the whole form.
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  // The confidence a person picked on a row that has no level yet, shown while it waits for one.
  const [held, setHeld] = useState<Readonly<Record<string, number>>>({});
  // Per row: the evidence boxes (read live), what the row last said, the tail of its write chain, how many writes are in it.
  const textareas = useRef(new Map<string, HTMLTextAreaElement>());
  const lastSent = useRef(new Map<string, RowIntent>());
  const queues = useRef(new Map<string, Promise<void>>());
  const inFlight = useRef(new Map<string, number>());

  if (ctx === undefined || weighed === undefined) return undefined;

  const names = new Map(ctx.set.criteria.map((criterion) => [criterion.id, criterion] as const));
  const scale = weighingScaleOf(ctx.set);
  const shown = new Set(weighed.cells.map((cell) => cell.criterion));
  const blank = extra.filter((id) => !shown.has(id));
  const addable = ctx.set.criteria.filter((criterion) => !shown.has(criterion.id) && !extra.includes(criterion.id));

  /**
   * Queue one write for a row. Its fields are worked out when its turn comes —
   * after the write before it settled — from the cell the gesture saw, what the
   * row last said and what this gesture changes. `onlyIfEvidenceChanged` is the
   * blur's: a blur that left the text as it was is not a write.
   */
  function write(criterion: string, cell: EffectiveCell | undefined, patch: RowIntent, onlyIfEvidenceChanged = false) {
    inFlight.current.set(criterion, (inFlight.current.get(criterion) ?? 0) + 1);
    setPending((current) => new Set(current).add(criterion));
    const task = async () => {
      const before = lastSent.current.get(criterion);
      if (onlyIfEvidenceChanged && !evidenceChanged(cell, before, patch.evidence ?? "")) return;
      // The box's live text rides along with every level or confidence write: what is typed is never lost to a click.
      const live = textareas.current.get(criterion)?.value;
      const fields = assessmentFieldsFor(cell, before, { ...(live === undefined ? {} : { evidence: live }), ...patch });
      if (fields === undefined) return; // a blank row is written once it has a level
      lastSent.current.set(criterion, intentOf(fields));
      try {
        await record([{ type: WEIGHING_ASSESSMENT_RECORDED, subject: node.id, criterion, ...fields }]);
        setExtra((current) => current.filter((id) => id !== criterion));
      } catch (error) {
        // Refused: the row did not say that, so the next write must not build on it.
        if (before === undefined) lastSent.current.delete(criterion);
        else lastSent.current.set(criterion, before);
        toast.error(error instanceof Error ? error.message : "Could not record that assessment.");
      }
    };
    const tail = (queues.current.get(criterion) ?? Promise.resolve()).then(task).finally(() => {
      const left = (inFlight.current.get(criterion) ?? 1) - 1;
      if (left > 0) {
        inFlight.current.set(criterion, left);
        return;
      }
      inFlight.current.delete(criterion);
      queues.current.delete(criterion);
      setPending((current) => {
        const next = new Set(current);
        next.delete(criterion);
        return next;
      });
    });
    queues.current.set(criterion, tail);
  }

  function chooseConfidence(criterion: string, cell: EffectiveCell | undefined, confidence: number) {
    const said = lastSent.current.get(criterion);
    // A row with no level, and none on its way: hold the pick and send it with the level.
    if (cell === undefined && said?.level === undefined && !inFlight.current.has(criterion)) {
      lastSent.current.set(criterion, { ...said, confidence });
      setHeld((current) => ({ ...current, [criterion]: confidence }));
      return;
    }
    write(criterion, cell, { confidence });
  }

  const rows: Row[] = [
    ...weighed.cells.map((cell) => ({ criterion: names.get(cell.criterion) ?? { id: cell.criterion }, cell })),
    ...blank.map((id) => ({ criterion: names.get(id) ?? { id }, cell: undefined })),
  ];

  return { ctx, weighed, scale, rows, addable, setExtra, pending, held, textareas, write, chooseConfidence };
}
type Editor = NonNullable<ReturnType<typeof useWeighingEditor>>;

// ── what it adds up to ──────────────────────────────────────────────────────

function Figures({ weighed: w }: { weighed: PromiseWeighing }) {
  return (
    <dl className="kap-wf" data-weighing-figures>
      <div className="kap-wf-tile" data-vt="served">
        <dt>Serves</dt>
        <dd data-weighing-served>{fmt(w.served)}</dd>
        <Meter value={w.served} max={4} guess={w.guesswork.served} />
      </div>
      <div className="kap-wf-tile" data-vt="cost" data-zero={w.cost === 0}>
        <dt>Costs</dt>
        <dd data-weighing-cost>{fmt(w.cost)}</dd>
        <Meter value={w.cost} max={4} tone="cost" guess={w.guesswork.cost} />
      </div>
      <div className="kap-wf-line" data-weighing-kept>
        <dt>Kept</dt>
        <dd>{w.kept_share === null ? "applies to no platform" : pct(w.kept_share)}</dd>
      </div>
      <div className="kap-wf-line" data-weighing-guesswork>
        <dt>Resting on guesses</dt>
        <dd>
          <GuessTag share={w.guesswork.served} />
          <span> of what it serves{w.cost > 0 ? `, ${pct(w.guesswork.cost)} of what it costs` : ""}</span>
        </dd>
      </div>
      {w.positioned !== null && (
        <div className="kap-wf-line" data-weighing-positioned>
          <dt>Of what we stand on</dt>
          <dd>
            serves {fmt(w.positioned.served)} · costs {fmt(w.positioned.cost)}
          </dd>
        </div>
      )}
    </dl>
  );
}

// ── the scale and its stops ─────────────────────────────────────────────────

/** Seven stops, −3..+3. Static (no control) when read-only. */
function LevelStops({ row, scale, readOnly, onPick }: { row: Row; scale: WeighingScale; readOnly: boolean; onPick: (level: number) => void }) {
  const { cell, criterion } = row;
  const label = labelOf(row);
  const who = cell === undefined ? undefined : whoOf(cell);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const others = cell?.others ?? [];
  const stops = WEIGHING_LEVELS.map((level) => {
    const rung = rungOf(criterion, scale, level);
    const on = cell?.level === level;
    const sign = level > 0 ? "plus" : level < 0 ? "minus" : "zero";
    const mark = others.filter((o) => o.level === level);
    const inner = (
      <>
        <span className="kap-st-n">{signed(level)}</span>
        {mark.map((o, i) => (
          <span key={i} className="kap-st-other" data-who={o.scorer?.kind === "agent" ? "agent" : "person"} aria-hidden="true" />
        ))}
      </>
    );
    return { level, rung, on, sign, inner };
  });

  if (readOnly) {
    const words = cell === undefined ? "not scored" : `level ${signed(cell.level)}, ${cell.source === "seed" ? "a guess" : whoWords(cell)}`;
    return (
      <div className="kap-st" data-readonly role="img" aria-label={`${label}: ${words}`}>
        {stops.map((s) => (
          <span key={s.level} className="kap-st-stop" data-sign={s.sign} data-on={s.on} data-who={s.on ? who : undefined} aria-hidden="true">
            {s.inner}
          </span>
        ))}
      </div>
    );
  }

  const tabbable = cell === undefined ? 3 : cell.level + 3; // the chosen one, else the zero
  const move = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = refs.current.findIndex((el) => el === document.activeElement);
    let next = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = Math.min(6, i + 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = Math.max(0, i - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = 6;
    if (next < 0 || i < 0) return;
    e.preventDefault();
    refs.current[next]?.focus();
  };
  return (
    <div className="kap-st" role="group" aria-label={`${label}: level`} onKeyDown={move}>
      {stops.map((s, i) => (
        <button
          key={s.level}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          className="kap-st-stop kap-press"
          data-sign={s.sign}
          data-on={s.on}
          data-who={s.on ? who : undefined}
          aria-pressed={s.on}
          aria-label={signed(s.level)}
          title={s.rung === undefined ? undefined : `${signed(s.level)}: ${s.rung}`}
          tabIndex={i === tabbable ? 0 : -1}
          onClick={() => onPick(s.level)}
        >
          {s.inner}
        </button>
      ))}
    </div>
  );
}

// ── a row's reasons ─────────────────────────────────────────────────────────

function Pips({ row, held, readOnly, onPick }: { row: Row; held: number | undefined; readOnly: boolean; onPick: (n: number) => void }) {
  const { cell } = row;
  const label = labelOf(row);
  const current = cell === undefined ? held : cell.confidence;
  if (readOnly) {
    return cell === undefined ? null : (
      <p className="kap-cf-ro" data-weighing-scorer>
        <span className="kap-cf" data-readonly aria-hidden="true">
          {CONFIDENCE_LEVELS.map((n) => (
            <span key={n} className="kap-cf-pip" data-on={n <= cell.confidence && n > 0} data-zero={n === 0 && cell.confidence === 0} />
          ))}
        </span>
        <span>
          {scorerLabel(cell)}, confidence {cell.confidence}
          <i> — {CONFIDENCE_ANCHORS[cell.confidence]}</i>
        </span>
      </p>
    );
  }
  return (
    <div className="kap-cf-wrap">
      <span className="kap-cf-k" aria-hidden="true">
        How sure
      </span>
      <div className="kap-cf" role="group" aria-label={`${label}: confidence`}>
        {CONFIDENCE_OPTIONS.map((o) => (
          <button
            key={o.id}
            type="button"
            className="kap-cf-btn kap-press"
            data-on={current !== undefined && Number(o.id) <= current && Number(o.id) > 0}
            data-zero={Number(o.id) === 0 && current === 0}
            aria-pressed={String(current ?? "") === o.id}
            aria-label={o.label}
            title={o.title}
            onClick={() => onPick(Number(o.id))}
          >
            <span className="kap-cf-pip" />
            <span className="kap-cf-n">{o.label}</span>
          </button>
        ))}
      </div>
      {cell !== undefined && <span className="kap-cf-words">{CONFIDENCE_ANCHORS[cell.confidence]}</span>}
    </div>
  );
}

function Badges({ cell }: { cell: EffectiveCell | undefined }) {
  if (cell === undefined) return null;
  return (
    <span className="kap-bd">
      {cell.claimed && (
        <span className="kap-bd-i" data-k="claimed">
          claimed
        </span>
      )}
      {cell.source === "seed" && (
        <span className="kap-bd-i" data-k="guess" title="Nobody weighed this: +1 per claimed value.">
          guess
        </span>
      )}
      {cell.stale && (
        <span
          className="kap-bd-i"
          data-k="stale"
          data-weighing-stale={cell.stale_by?.join(" ") ?? ""}
          title="Choose the level again — even the one already chosen — to score it against the promise and the ruler as they read now."
        >
          {staleWords(cell)}
        </span>
      )}
      {cell.review && (
        <span className="kap-bd-i" data-k="review" data-weighing-review>
          a person and an agent differ: review
        </span>
      )}
      {cell.uncertain && (
        <span className="kap-bd-i" data-k="range" data-weighing-uncertain title="The scorer was unsure of this level's direction: read it as a range, not a point. It still counts as scored.">
          range
        </span>
      )}
    </span>
  );
}

function Evidence({ ed, row, readOnly }: { ed: Editor; row: Row; readOnly: boolean }) {
  const { cell, criterion } = row;
  const label = labelOf(row);
  const shownText = cell?.source === "stored" && cell.evidence !== undefined && cell.evidence.trim() !== "" && (readOnly || cell.scorer.kind !== "human");
  const mine = cell?.scorer.kind === "human" && cell.source === "stored" && (cell.evidence ?? "").trim() !== "";
  return (
    <>
      {/* The reasons behind a score that is not the person's: it has no box of its own to sit in. A read-only panel shows every one. */}
      {shownText && cell && (
        <p data-weighing-evidence className="kap-ev">
          <span className="kap-ev-k">Evidence</span> {cell.evidence}
        </p>
      )}
      {!readOnly && (
        <details className="kap-ev-box" open={mine || undefined}>
          <summary>{mine ? "Your evidence" : "Why this level?"}</summary>
          <Textarea
            // Re-mounts when the stored evidence changes, so an agent's refresh or this person's own save shows.
            key={`${criterion.id}:${cell?.evidence ?? ""}`}
            ref={(element) => {
              if (element === null) ed.textareas.current.delete(criterion.id);
              else ed.textareas.current.set(criterion.id, element);
            }}
            aria-label={`${label}: evidence`}
            placeholder="Why this level? Cite what you read."
            defaultValue={cell?.scorer.kind === "human" ? cell.evidence : undefined}
            rows={2}
            // Saves on blur, never per keystroke; the box is the source of truth for its own text, so a level or confidence write reads it live.
            onBlur={(event) => ed.write(criterion.id, cell, { evidence: event.currentTarget.value }, true)}
          />
        </details>
      )}
    </>
  );
}

function Others({ cell }: { cell: EffectiveCell | undefined }) {
  if (cell === undefined || cell.others.length === 0) return null;
  return (
    <p data-weighing-others className="kap-ot">
      {cell.others.map((row) => `${row.scorer?.kind === "agent" ? "An agent" : "A person"} reads ${signed(row.level)} (confidence ${row.confidence})`).join("; ")}
    </p>
  );
}

// ── the ledger ──────────────────────────────────────────────────────────────

function LedgerRow({ ed, row, readOnly }: { ed: Editor; row: Row; readOnly: boolean }) {
  const { cell, criterion } = row;
  const [open, setOpen] = useState(false);
  const label = labelOf(row);
  const rung = rungFor(row, ed.scale);
  return (
    <li
      className="kap-lg"
      data-weighing-element={criterion.id}
      data-source={cell?.source ?? "blank"}
      data-level={cell?.level ?? ""}
      data-stale={cell?.stale ? "true" : "false"}
      data-uncertain={cell?.uncertain ? "true" : "false"}
      data-pending={ed.pending.has(criterion.id) ? "true" : "false"}
      aria-busy={ed.pending.has(criterion.id)}
      data-open={open}
      data-who={cell === undefined ? "blank" : whoOf(cell)}
    >
      <div className="kap-lg-line">
        <button type="button" className="kap-lg-name kap-press" aria-expanded={open} onClick={() => setOpen((v) => !v)} title="Show the reasons">
          <ValueIcon valueId={criterion.id as ValueId} className="size-3.5 shrink-0" />
          <span>{label}</span>
        </button>
        <LevelStops row={row} scale={ed.scale} readOnly={readOnly} onPick={(level) => ed.write(criterion.id, cell, { level })} />
      </div>
      <div className="kap-lg-sub">
        <Badges cell={cell} />
        {rung !== undefined && cell !== undefined && (
          <span data-weighing-rung className="kap-lg-rung">
            <b>{signed(cell.level)}</b> {rung}
          </span>
        )}
        {cell === undefined && !readOnly && (
          <span data-weighing-hint className="kap-lg-rung">
            Choose a level to score this element.
          </span>
        )}
        {cell === undefined && readOnly && (
          <span data-weighing-readonly className="kap-lg-rung">
            Not scored.
          </span>
        )}
        {cell !== undefined && readOnly && (
          <span data-weighing-readonly className="sr-only">
            Level {signed(cell.level)}
          </span>
        )}
      </div>
      {open && (
        <div className="kap-lg-more">
          {criterion.question !== undefined && (
            <p data-weighing-question className="kap-q">
              {criterion.question}
            </p>
          )}
          {cell !== undefined &&
            (readOnly ? (
              <Pips row={row} held={undefined} readOnly onPick={() => undefined} />
            ) : (
              <p className="kap-who" data-weighing-scorer>
                {scorerLabel(cell)}
              </p>
            ))}
          {!readOnly && <Pips row={row} held={ed.held[criterion.id]} readOnly={false} onPick={(n) => ed.chooseConfidence(criterion.id, cell, n)} />}
          <Evidence ed={ed} row={row} readOnly={readOnly} />
          <Others cell={cell} />
        </div>
      )}
      {/* A closed row still holds its evidence box in the tree, so a level click reads what was typed. */}
      {!open && !readOnly && (
        <div hidden>
          <Evidence ed={ed} row={row} readOnly={false} />
        </div>
      )}
    </li>
  );
}

function AddElement({ ed }: { ed: Editor }) {
  if (ed.addable.length === 0) return null;
  return (
    <div className="kap-add">
      {/* The app's own Select, held at "" so it is a menu of actions and never shows a choice:
          picking an element opens a blank row for it, and the row leaves the list. */}
      <Select
        value=""
        onValueChange={(id) => {
          if (id !== "") ed.setExtra((current) => [...current, id]);
        }}
      >
        <SelectTrigger data-weighing-add aria-label="Add an element of value">
          <SelectValue placeholder="Add an element of value…" />
        </SelectTrigger>
        <SelectContent>
          {(ed.ctx.set.groups ?? []).map((group) => {
            const inGroup = ed.addable.filter((criterion) => criterion.group === group.id);
            return inGroup.length === 0 ? null : (
              <SelectGroup key={group.id}>
                <SelectLabel>{group.title}</SelectLabel>
                {inGroup.map((criterion) => (
                  <SelectItem key={criterion.id} value={criterion.id}>
                    {criterion.name ?? criterion.id}
                  </SelectItem>
                ))}
              </SelectGroup>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
}

export function WeighingGroup({ node, readOnly = false }: WeighingGroupProps) {
  const ed = useWeighingEditor(node);
  if (ed === undefined) return null;
  const w = ed.weighed;
  const first = ed.rows.filter(worthALook);
  const rest = ed.rows.filter((row) => !worthALook(row));
  return (
    <PanelGroup
      title="Value"
      meta={
        <span data-weighing-meta>
          serves {fmt(w.served)} · costs {fmt(w.cost)}
        </span>
      }
    >
      <div data-weighing data-weighing-subject={node.id} className={`${dynaPuff.variable} kap-scope kap-w`}>
        <div className={`${PANEL_GUTTER} kap-ws`}>
          <Figures weighed={w} />
          {ed.ctx.positioningSet !== undefined && ed.ctx.positioning === null && (
            <p data-weighing-draft className="kap-ws-note">
              The positioning is a draft, so nothing is weighed against it yet.
            </p>
          )}
          <FlagSentences weighing={w} />
        </div>
        {ed.rows.length === 0 ? (
          <p data-weighing-empty className={`${PANEL_GUTTER} kap-w-empty`}>
            This promise claims no value and nobody has scored one.{readOnly ? "" : " Add the first element below."}
          </p>
        ) : (
          <div className={`${PANEL_GUTTER} kap-lg-wrap`}>
            <div className="kap-lg-scale" aria-hidden="true">
              {WEIGHING_LEVELS.map((n) => (
                <span key={n}>{signed(n)}</span>
              ))}
            </div>
            <ul className="kap-lg-list">
              {first.map((row) => (
                <LedgerRow key={row.criterion.id} ed={ed} row={row} readOnly={readOnly} />
              ))}
            </ul>
            {rest.length > 0 && (
              <details className="kap-fold" open={first.length === 0 || undefined}>
                <summary>
                  <span>{first.length > 0 ? "Also weighed, nothing to flag" : "Weighed"}</span>
                  <b>{rest.length}</b>
                </summary>
                <ul className="kap-lg-list">
                  {rest.map((row) => (
                    <LedgerRow key={row.criterion.id} ed={ed} row={row} readOnly={readOnly} />
                  ))}
                </ul>
              </details>
            )}
            {!readOnly && <AddElement ed={ed} />}
          </div>
        )}
        {ed.rows.length === 0 && !readOnly && (
          <div className={PANEL_GUTTER}>
            <AddElement ed={ed} />
          </div>
        )}
      </div>
    </PanelGroup>
  );
}
