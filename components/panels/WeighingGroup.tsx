"use client";

import { useMemo, useState } from "react";
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
  type WeighingEventInput,
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
 */

interface WeighingGroupProps {
  node: Node;
  /** No save path: show the weight, offer no controls. */
  readOnly?: boolean;
}

const LEVEL_OPTIONS = WEIGHING_LEVELS.map((level) => ({ id: String(level), label: level > 0 ? `+${level}` : level < 0 ? `−${-level}` : "0" }));
const CONFIDENCE_OPTIONS = CONFIDENCE_LEVELS.map((level) => ({ id: String(level), label: String(level) }));

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
  const [pending, setPending] = useState<string | null>(null);

  if (ctx === undefined || weighed === undefined) return null;

  const names = new Map(ctx.set.criteria.map((criterion) => [criterion.id, criterion] as const));
  const shown = new Set(weighed.cells.map((cell) => cell.criterion));
  const blank = extra.filter((id) => !shown.has(id));
  const addable = ctx.set.criteria.filter((criterion) => !shown.has(criterion.id) && !extra.includes(criterion.id));

  async function save(criterion: string, cell: EffectiveCell | undefined, patch: { level?: number; confidence?: number; evidence?: string }) {
    // What a person has already said about this cell — never an agent's evidence, which is not theirs to inherit.
    const mine = cell?.source === "stored" && cell.scorer.kind === "human" ? cell : undefined;
    const level = patch.level ?? cell?.level;
    if (level === undefined) return;
    const evidence = patch.evidence ?? mine?.evidence;
    const input: WeighingEventInput = {
      type: WEIGHING_ASSESSMENT_RECORDED,
      subject: node.id,
      criterion,
      level,
      confidence: patch.confidence ?? mine?.confidence ?? 1,
      ...(evidence !== undefined && evidence.trim() !== "" ? { evidence } : {}),
    };
    setPending(criterion);
    try {
      await record([input]);
      setExtra((current) => current.filter((id) => id !== criterion));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not record that assessment.");
    } finally {
      setPending(null);
    }
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
              This promise claims no value and nobody has scored one. Add the first element below.
            </p>
          ) : (
            <ul className="flex flex-col gap-4">
              {rows.map(({ criterion, cell }) => (
                <li
                  key={criterion.id}
                  data-weighing-element={criterion.id}
                  data-source={cell?.source ?? "blank"}
                  data-level={cell?.level ?? ""}
                  data-stale={cell?.stale ? "true" : "false"}
                  className="flex flex-col gap-2"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{criterion.name ?? criterion.id}</span>
                    {cell?.claimed && <Badge variant="outline">claimed</Badge>}
                    {cell?.stale && (
                      <Badge data-weighing-stale variant="secondary">
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
                  {readOnly ? (
                    <p data-weighing-readonly className="text-sm">
                      {cell === undefined ? "Not scored" : `Level ${cell.level > 0 ? "+" : ""}${cell.level}`}
                    </p>
                  ) : (
                    <>
                      <SegmentedControl
                        ariaLabel={`${criterion.name ?? criterion.id}: level`}
                        options={LEVEL_OPTIONS}
                        value={cell === undefined ? "" : String(cell.level)}
                        onChange={(value) => void save(criterion.id, cell, { level: Number(value) })}
                      />
                      <SegmentedControl
                        ariaLabel={`${criterion.name ?? criterion.id}: confidence`}
                        options={CONFIDENCE_OPTIONS}
                        value={cell === undefined ? "" : String(cell.confidence)}
                        onChange={(value) => void save(criterion.id, cell, { confidence: Number(value) })}
                      />
                      <p className="text-xs text-muted-foreground">
                        {cell === undefined ? "Choose a level to score this element." : CONFIDENCE_ANCHORS[cell.confidence]}
                      </p>
                      <Textarea
                        // Re-mounts when the stored evidence changes, so an agent's refresh or this person's own save shows.
                        key={`${criterion.id}:${cell?.evidence ?? ""}`}
                        aria-label={`${criterion.name ?? criterion.id}: evidence`}
                        placeholder="Why this level? Cite what you read."
                        defaultValue={cell?.scorer.kind === "human" ? cell.evidence : undefined}
                        disabled={pending === criterion.id || cell === undefined}
                        rows={2}
                        onBlur={(event) => {
                          const next = event.currentTarget.value;
                          if (cell !== undefined && next !== (cell.scorer.kind === "human" ? (cell.evidence ?? "") : "")) {
                            void save(criterion.id, cell, { evidence: next });
                          }
                        }}
                      />
                    </>
                  )}
                  {cell !== undefined && cell.others.length > 0 && (
                    <p data-weighing-others className="text-xs text-muted-foreground">
                      {cell.others.map((row) => `${row.scorer?.kind === "agent" ? "An agent" : "A person"} reads ${row.level > 0 ? "+" : ""}${row.level} (confidence ${row.confidence})`).join("; ")}
                    </p>
                  )}
                </li>
              ))}
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
