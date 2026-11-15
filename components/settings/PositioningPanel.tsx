"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  POSITIONING_SET_ID,
  VALUE_SET_ID,
  WEIGHING_SET_SAVED,
  isActiveWeighingSet,
  resolveWeighing,
  weighingScaleOf,
  type WeighingCriteriaSet,
  type WeighingCriterion,
} from "@arkaik/schema";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Textarea } from "@/components/ui/textarea";
import { useWeighing } from "@/lib/hooks/useWeighing";

/**
 * The Positioning section of project settings: which elements of value the
 * product stands on, how much, and — in the product's own words — what each
 * level means (docs/rfcs/weighing.md).
 *
 * **Why here, and not on the Pyramid.** Settings is where this app keeps
 * everything that configures a project rather than describes it (products live
 * here for the same reason), and a positioning is a statement of intent, not a
 * reading. The Pyramid is a derived page: it should stay a place that shows what
 * the product is, and not also be where you decide what it ought to be. It is
 * also the page the next design pass reshapes, and an editor does not want to
 * move with it.
 *
 * A positioning is a criteria set: each element it lists carries a weight (1–3)
 * and, optionally, the product's wording for three levels — the top (+3), the
 * middle (0) and the bottom (−3). Those words are what a scorer that is not the
 * author (an agent, Jev.ai) reads to judge a promise, because a bare label is
 * not enough. An element that is not listed is not stood on.
 *
 * A **draft** feeds no roll-up: an agent may draft one from the landing page or
 * a brainstorm, and a person reads it and activates it here. Saving writes one
 * `weighing.set.saved` event (latest wins) through `useWeighing`'s `record`,
 * the same gate as every other write.
 */

interface RowState {
  on: boolean;
  weight: number;
  top: string;
  middle: string;
  bottom: string;
}

const WEIGHT_OPTIONS = [
  { id: "1", label: "1" },
  { id: "2", label: "2" },
  { id: "3", label: "3" },
];

function initialRows(ruler: WeighingCriteriaSet, saved: WeighingCriteriaSet | undefined): Record<string, RowState> {
  const rows: Record<string, RowState> = {};
  for (const criterion of ruler.criteria) {
    const own = saved?.criteria.find((candidate) => candidate.id === criterion.id);
    rows[criterion.id] = {
      on: own !== undefined,
      weight: typeof own?.weight === "number" ? Math.min(3, Math.max(1, Math.round(own.weight))) : 2,
      top: own?.anchors?.["3"] ?? "",
      middle: own?.anchors?.["0"] ?? "",
      bottom: own?.anchors?.["-3"] ?? "",
    };
  }
  return rows;
}

function toCriterion(id: string, row: RowState): WeighingCriterion {
  const anchors: Record<string, string> = {};
  if (row.top.trim() !== "") anchors["3"] = row.top.trim();
  if (row.middle.trim() !== "") anchors["0"] = row.middle.trim();
  if (row.bottom.trim() !== "") anchors["-3"] = row.bottom.trim();
  return { id, weight: row.weight, ...(Object.keys(anchors).length > 0 ? { anchors } : {}) };
}

export function PositioningPanel({ projectId }: { projectId: string }) {
  const { section, record } = useWeighing(projectId);
  const resolved = useMemo(() => resolveWeighing(section), [section]);
  // A saved positioning the resolver dropped as malformed would otherwise just vanish from this form.
  const malformed = resolved.skipped.some((entry) => entry.kind === "set" && (entry.id === POSITIONING_SET_ID || entry.role === "positioning"));
  const ruler = resolved.sets.find((set) => set.id === VALUE_SET_ID);
  const saved = resolved.sets.find((set) => set.id === POSITIONING_SET_ID && set.role === "positioning");

  // Keyed on the saved set's identity so a refetch after a save re-seeds the form.
  const seed = useMemo(() => (ruler === undefined ? {} : initialRows(ruler, saved)), [ruler, saved]);
  const [rows, setRows] = useState<Record<string, RowState>>(seed);
  const [seededFrom, setSeededFrom] = useState(seed);
  const [saving, setSaving] = useState(false);
  if (seed !== seededFrom) {
    setSeededFrom(seed);
    setRows(seed);
  }

  if (ruler === undefined) return null;

  const standingOn = ruler.criteria.filter((criterion) => rows[criterion.id]?.on);
  const status = saved === undefined ? "none" : isActiveWeighingSet(saved) ? "active" : "draft";

  function patch(id: string, change: Partial<RowState>) {
    setRows((current) => ({ ...current, [id]: { ...current[id], ...change } }));
  }

  async function save(next: "draft" | "active") {
    if (ruler === undefined) return;
    const set: WeighingCriteriaSet = {
      id: POSITIONING_SET_ID,
      version: "1.0.0",
      title: "Positioning",
      subject: ruler.subject,
      scale: weighingScaleOf(ruler),
      role: "positioning",
      status: next,
      extends: `${ruler.id}@${ruler.version.split(".")[0]}`,
      criteria: ruler.criteria.filter((criterion) => rows[criterion.id]?.on).map((criterion) => toCriterion(criterion.id, rows[criterion.id])),
    };
    setSaving(true);
    try {
      await record([{ type: WEIGHING_SET_SAVED, set }]);
      toast.success(next === "active" ? "Positioning saved and active." : "Positioning saved as a draft.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the positioning.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div data-positioning data-positioning-status={status} className="flex flex-col gap-4">
      {malformed && (
        <p data-positioning-malformed className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          Your saved positioning is malformed and is ignored. Saving will replace it.
        </p>
      )}
      {status === "draft" && (
        <p data-positioning-draft className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          This is a draft. It feeds no weight until you save it as active.
        </p>
      )}
      {(ruler.groups ?? []).map((group) => (
        <fieldset key={group.id} data-positioning-tier={group.id} className="flex flex-col gap-3">
          <legend className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{group.title}</legend>
          {ruler.criteria
            .filter((criterion) => criterion.group === group.id)
            .map((criterion) => {
              const row = rows[criterion.id];
              if (row === undefined) return null;
              return (
                <div key={criterion.id} data-positioning-element={criterion.id} data-on={row.on ? "true" : "false"} className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <label className="flex items-center gap-2 text-sm font-medium">
                      <Checkbox
                        checked={row.on}
                        aria-describedby={`positioning-definition-${criterion.id}`}
                        onCheckedChange={(checked) => patch(criterion.id, { on: checked === true })}
                      />
                      {criterion.name ?? criterion.id}
                    </label>
                    {/* Outside the label, so the element's name is the checkbox's name and its definition its description. */}
                    <span id={`positioning-definition-${criterion.id}`} className="text-xs font-normal text-muted-foreground">
                      {criterion.definition}
                    </span>
                  </div>
                  {row.on && (
                    <div className="flex flex-col gap-2 pl-6">
                      <SegmentedControl
                        ariaLabel={`${criterion.name ?? criterion.id}: weight`}
                        options={WEIGHT_OPTIONS}
                        value={String(row.weight)}
                        onChange={(value) => patch(criterion.id, { weight: Number(value) })}
                      />
                      <Textarea
                        aria-label={`${criterion.name ?? criterion.id}: what +3 means for us`}
                        placeholder="+3 means, in our words…"
                        title={criterion.anchors?.["3"] === undefined ? undefined : `The ruler's +3: ${criterion.anchors["3"]}`}
                        rows={2}
                        value={row.top}
                        onChange={(event) => patch(criterion.id, { top: event.currentTarget.value })}
                      />
                      <Textarea
                        aria-label={`${criterion.name ?? criterion.id}: what 0 means for us`}
                        placeholder="0 means, in our words…"
                        rows={2}
                        value={row.middle}
                        onChange={(event) => patch(criterion.id, { middle: event.currentTarget.value })}
                      />
                      <Textarea
                        aria-label={`${criterion.name ?? criterion.id}: what −3 means for us`}
                        placeholder="−3 means, in our words…"
                        title={criterion.anchors?.["-3"] === undefined ? undefined : `The ruler's −3: ${criterion.anchors["-3"]}`}
                        rows={2}
                        value={row.bottom}
                        onChange={(event) => patch(criterion.id, { bottom: event.currentTarget.value })}
                      />
                    </div>
                  )}
                </div>
              );
            })}
        </fieldset>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" disabled={saving || standingOn.length === 0} onClick={() => void save("draft")}>
          Save as draft
        </Button>
        <Button type="button" disabled={saving || standingOn.length === 0} onClick={() => void save("active")}>
          {status === "active" ? "Save" : "Save and activate"}
        </Button>
        <span data-positioning-count className="text-xs text-muted-foreground">
          {standingOn.length === 0 ? "No element chosen yet." : `${standingOn.length} element${standingOn.length === 1 ? "" : "s"} stood on.`}
        </span>
      </div>
    </div>
  );
}
