"use client";

import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  CONFIDENCE_ANCHORS,
  CONFIDENCE_LEVELS,
  WEIGHING_ASSESSMENT_RECORDED,
  WEIGHING_LEVELS,
  buildWeighingContext,
  weighPromise,
  type EffectiveCell,
  type WeighingCriterion,
} from "@arkaik/schema";

import { PanelGroup } from "@/components/panels/PanelGroup";
import { PanelSection } from "@/components/panels/PanelSection";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Textarea } from "@/components/ui/textarea";
import type { Node } from "@/lib/data/types";
import { useProjectId } from "@/lib/hooks/useProjectId";
import { useWeighing } from "@/lib/hooks/useWeighing";
import { assessmentFieldsFor, evidenceChanged, intentOf, type RowIntent } from "@/lib/utils/weighing-input";

/**
 * An acceptance's weight: a signed level (−3 to +3) for each element of value it
 * touches, how sure the scorer is, and why — with what that adds up to
 * (docs/rfcs/weighing.md).
 *
 * **A functional baseline, not a design.** The markup is plain and every part
 * carries a `data-weighing-*` hook, so the look can be explored afterwards
 * (skill `redesigning-with-tweaks`) without touching what it says. What this
 * file owns is the behaviour:
 *
 * - The elements the author *claimed* come first, in claim order, then every
 *   other element somebody has scored; the rest wait behind "Add an element".
 * - A cell nobody has scored reads at its **seeded** level and says so: a guess
 *   from the order of `values`, never a score. Choosing a level writes the
 *   first human assessment and replaces the guess — at confidence 1 ("inferred
 *   from the promise's own text") unless a person says otherwise, because
 *   nobody picking a level on a form means "I guessed".
 * - A cell shows its **effective** level, who scored it, whether it has gone
 *   **stale** (the promise's title, Gherkin or values changed since), and — when
 *   a human and an agent disagree by two or more — that it wants a review. A
 *   human's level wins; an agent's rides beside it.
 * - **Served and cost** sit above the list, never netted, with the share that
 *   rests on guesses.
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

// A bare "2" says little: each option carries its anchor as a tooltip and a description.
const CONFIDENCE_OPTIONS = CONFIDENCE_LEVELS.map((level) => ({ id: String(level), label: String(level), title: CONFIDENCE_ANCHORS[level] }));

/** A level as a person reads it: a real minus, an explicit plus. */
const signed = (level: number) => (level > 0 ? `+${level}` : level < 0 ? `−${-level}` : "0");

const LEVEL_OPTIONS = WEIGHING_LEVELS.map((level) => ({ id: String(level), label: signed(level) }));

const pct = (share: number) => `${Math.round(share * 100)}%`;
const num = (value: number) => (Math.round(value * 100) / 100).toFixed(2);

function scorerLabel(cell: EffectiveCell): string {
  if (cell.source === "seed") return "Guess, from the order of the claimed values";
  const model = typeof cell.scorer.model === "string" ? ` (${cell.scorer.model})` : "";
  return `${cell.scorer.kind === "human" ? "A person" : "An agent"}: ${cell.scorer.id}${model}`;
}

export function WeighingGroup({ node, readOnly = false }: WeighingGroupProps) {
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

  if (ctx === undefined || weighed === undefined) return null;

  const names = new Map(ctx.set.criteria.map((criterion) => [criterion.id, criterion] as const));
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

  const rows: { criterion: WeighingCriterion; cell: EffectiveCell | undefined }[] = [
    ...weighed.cells.map((cell) => ({ criterion: names.get(cell.criterion) ?? { id: cell.criterion }, cell })),
    ...blank.map((id) => ({ criterion: names.get(id) ?? { id }, cell: undefined })),
  ];

  const flagged = [
    ["Claim not supported", weighed.flags.claim_not_supported],
    ["Claim contradicted", weighed.flags.claim_contradicted],
    ["Unclaimed value", weighed.flags.unclaimed_value],
    ["Unclaimed cost", weighed.flags.unclaimed_cost],
  ] as const;

  return (
    <PanelGroup
      title="Value"
      meta={
        <span data-weighing-meta>
          serves {num(weighed.served)} · costs {num(weighed.cost)}
        </span>
      }
    >
      <div data-weighing data-weighing-subject={node.id} className="flex flex-col gap-4">
        <PanelSection title="What it adds up to">
          <dl data-weighing-figures className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Serves</dt>
            <dd data-weighing-served>{num(weighed.served)}</dd>
            <dt className="text-muted-foreground">Costs</dt>
            <dd data-weighing-cost>{num(weighed.cost)}</dd>
            {weighed.positioned !== null && (
              <>
                <dt className="text-muted-foreground">Of what we stand on</dt>
                <dd data-weighing-positioned>
                  serves {num(weighed.positioned.served)} · costs {num(weighed.positioned.cost)}
                </dd>
              </>
            )}
            <dt className="text-muted-foreground">Kept</dt>
            <dd data-weighing-kept>{weighed.kept_share === null ? "applies to no platform" : pct(weighed.kept_share)}</dd>
            <dt className="text-muted-foreground">Resting on guesses</dt>
            <dd data-weighing-guesswork>
              {pct(weighed.guesswork.served)} of what it serves{weighed.cost > 0 ? `, ${pct(weighed.guesswork.cost)} of what it costs` : ""}
            </dd>
          </dl>
          {ctx.positioningSet !== undefined && ctx.positioning === null && (
            <p data-weighing-draft className="text-xs text-muted-foreground">
              The positioning is a draft, so nothing is weighed against it yet.
            </p>
          )}
          {flagged.some(([, ids]) => ids.length > 0) && (
            <ul data-weighing-flags className="flex flex-col gap-1 text-xs">
              {flagged.map(([label, ids]) =>
                ids.length === 0 ? null : (
                  <li key={label} data-weighing-flag={label}>
                    <span className="font-medium">{label}:</span> {ids.map((id) => names.get(id)?.name ?? id).join(", ")}
                  </li>
                ),
              )}
            </ul>
          )}
        </PanelSection>

        <PanelSection title="Elements of value">
          {rows.length === 0 ? (
            <p data-weighing-empty className="text-sm text-muted-foreground">
              This promise claims no value and nobody has scored one.{readOnly ? "" : " Add the first element below."}
            </p>
          ) : (
            <ul className="flex flex-col gap-4">
              {rows.map(({ criterion, cell }) => {
                const label = criterion.name ?? criterion.id;
                // A score that is not the person's: an agent's, or the guess. Choosing here records their own.
                const notMine = cell !== undefined && (cell.source === "seed" || cell.scorer.kind !== "human");
                return (
                  <li
                    key={criterion.id}
                    data-weighing-element={criterion.id}
                    data-source={cell?.source ?? "blank"}
                    data-level={cell?.level ?? ""}
                    data-stale={cell?.stale ? "true" : "false"}
                    data-pending={pending.has(criterion.id) ? "true" : "false"}
                    aria-busy={pending.has(criterion.id)}
                    className="flex flex-col gap-2"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{label}</span>
                      {cell?.claimed && <Badge variant="outline">claimed</Badge>}
                      {cell?.stale && (
                        <Badge
                          data-weighing-stale
                          variant="secondary"
                          title="Choose the level again — even the one already chosen — to score it against the promise as it reads now."
                        >
                          stale: the promise changed since this was scored
                        </Badge>
                      )}
                      {cell?.review && (
                        <Badge data-weighing-review variant="secondary">
                          a person and an agent differ: review
                        </Badge>
                      )}
                    </div>
                    {cell !== undefined && (
                      <p data-weighing-scorer className="text-xs text-muted-foreground">
                        {scorerLabel(cell)}, confidence {cell.confidence}
                      </p>
                    )}
                    {/* The reasons behind a score that is not the person's: it has no box of its own to sit in. A read-only panel shows every one. */}
                    {cell?.source === "stored" && cell.evidence !== undefined && cell.evidence.trim() !== "" && (readOnly || cell.scorer.kind !== "human") && (
                      <p data-weighing-evidence className="text-xs whitespace-pre-wrap">
                        <span className="font-medium">Evidence:</span> {cell.evidence}
                      </p>
                    )}
                    {readOnly ? (
                      <p data-weighing-readonly className="text-sm">
                        {cell === undefined ? "Not scored" : `Level ${signed(cell.level)}`}
                      </p>
                    ) : (
                      <>
                        <div className="flex flex-col gap-1">
                          <span className="text-xs text-muted-foreground" aria-hidden="true">
                            Level
                          </span>
                          <SegmentedControl
                            ariaLabel={`${label}: level`}
                            options={LEVEL_OPTIONS}
                            value={cell === undefined ? "" : String(cell.level)}
                            onChange={(value) => write(criterion.id, cell, { level: Number(value) })}
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <span className="text-xs text-muted-foreground" aria-hidden="true">
                            How sure
                          </span>
                          <SegmentedControl
                            ariaLabel={`${label}: confidence`}
                            options={CONFIDENCE_OPTIONS}
                            value={cell === undefined ? (held[criterion.id] === undefined ? "" : String(held[criterion.id])) : String(cell.confidence)}
                            onChange={(value) => chooseConfidence(criterion.id, cell, Number(value))}
                          />
                        </div>
                        {cell === undefined ? (
                          <p data-weighing-hint className="text-xs text-muted-foreground">
                            Choose a level to score this element.
                          </p>
                        ) : (
                          <>
                            {notMine && (
                              <p data-weighing-hint className="text-xs text-muted-foreground">
                                {cell.source === "seed"
                                  ? "Choosing a level here records your own score, in place of the guess."
                                  : "Choosing a level here records your own score, which outranks the agent's."}
                              </p>
                            )}
                            <p className="text-xs text-muted-foreground">{CONFIDENCE_ANCHORS[cell.confidence]}</p>
                          </>
                        )}
                        <Textarea
                          // Re-mounts when the stored evidence changes, so an agent's refresh or this person's own save shows.
                          key={`${criterion.id}:${cell?.evidence ?? ""}`}
                          ref={(element) => {
                            if (element === null) textareas.current.delete(criterion.id);
                            else textareas.current.set(criterion.id, element);
                          }}
                          aria-label={`${label}: evidence`}
                          placeholder="Why this level? Cite what you read."
                          defaultValue={cell?.scorer.kind === "human" ? cell.evidence : undefined}
                          rows={2}
                          // Saves on blur, never per keystroke; the box is the source of truth for its own text, so a level or confidence write reads it live.
                          onBlur={(event) => write(criterion.id, cell, { evidence: event.currentTarget.value }, true)}
                        />
                      </>
                    )}
                    {cell !== undefined && cell.others.length > 0 && (
                      <p data-weighing-others className="text-xs text-muted-foreground">
                        {cell.others.map((row) => `${row.scorer?.kind === "agent" ? "An agent" : "A person"} reads ${signed(row.level)} (confidence ${row.confidence})`).join("; ")}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </PanelSection>

        {!readOnly && addable.length > 0 && (
          <PanelSection title="Add an element">
            {/* The app's own Select, held at "" so it is a menu of actions and never shows a choice:
                picking an element opens a blank row for it, and the row leaves the list. */}
            <Select
              value=""
              onValueChange={(id) => {
                if (id !== "") setExtra((current) => [...current, id]);
              }}
            >
              <SelectTrigger data-weighing-add aria-label="Add an element of value">
                <SelectValue placeholder="Choose an element…" />
              </SelectTrigger>
              <SelectContent>
                {(ctx.set.groups ?? []).map((group) => {
                  const inGroup = addable.filter((criterion) => criterion.group === group.id);
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
          </PanelSection>
        )}
      </div>
    </PanelGroup>
  );
}
