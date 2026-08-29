"use client";

import { GemIcon } from "lucide-react";
import { GRADE_TINT } from "@/components/quality/quality-styles";
import type { SurfaceGauge } from "@/lib/utils/quality";
import { cn } from "@/lib/utils";
import { useOverviewLayoutContext } from "./OverviewLayoutContext";
import { OverviewSection } from "./OverviewSection";

interface QualityCardProps {
  /** One per audited surface (`buildSurfaceGauges`); empty when nothing is scored. */
  gauges: SurfaceGauge[];
  projectId: string;
}

/**
 * The audit's roll-up per surface: the matrix's own overall score, its grade,
 * and how much is still open there.
 *
 * **Absent when there is nothing audited**, on `ParityCard`'s precedent and for
 * its reason: a project with no Kritik section has not scored badly, it has not
 * scored at all, and a heading over "no audit yet" is a row of the dashboard
 * spent explaining its own absence — on every project that never adopts the
 * layer, that row would appear on every single visit. The empty check is the
 * gauges themselves rather than a `quality` flag, so an audit that exists but
 * has scored nothing is silent too, which is the same news.
 *
 * Not one number is computed here: `buildSurfaceGauges` reads the score off
 * `deriveQualityMatrix` and bands the grade with the pack's own scales, so this
 * card and the Quality page cannot disagree about how the product is doing.
 */
export function QualityCard({ gauges, projectId }: QualityCardProps) {
  const asTiles = useOverviewLayoutContext() === "rows";

  if (gauges.length === 0) return null;

  // The findings these rows actually account for, not the section's total: a
  // finding filed on a surface the profile no longer declares has no gauge to
  // sit under, and counting it here would make the sum unexplainable from the
  // rows beneath it.
  const openFindings = gauges.reduce((total, gauge) => total + gauge.openFindings, 0);

  return (
    <OverviewSection
      title="Quality"
      icon={GemIcon}
      description="How the product scores against its audit pack, surface by surface."
      subtitle={`${openFindings} open finding${openFindings === 1 ? "" : "s"} across ${gauges.length} surface${gauges.length === 1 ? "" : "s"}`}
      href={`/project/${projectId}/quality/matrix`}
      linkLabel="Quality"
    >
      {asTiles ? (
        <div className="flex flex-wrap gap-3">
          {gauges.map((gauge) => (
            <div
              key={gauge.surface}
              className="flex min-w-[9rem] flex-1 items-center gap-3 rounded-lg border bg-card px-3 py-2.5"
            >
              <GradeMark grade={gauge.grade} className="size-10 rounded-lg text-lg" />
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium">{gauge.title}</span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {gauge.score === null ? "Not scored" : `${gauge.score}/100`} · {gauge.openFindings} open
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {gauges.map((gauge) => (
            <li key={gauge.surface} className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate font-medium">{gauge.title}</span>
              <span className="flex shrink-0 items-center gap-2 tabular-nums text-muted-foreground">
                <span>{gauge.openFindings} open</span>
                <span className="font-medium text-foreground">{gauge.score === null ? "—" : gauge.score}</span>
                <GradeMark grade={gauge.grade} className="size-5 rounded text-[11px]" />
              </span>
            </li>
          ))}
        </ul>
      )}
    </OverviewSection>
  );
}

/**
 * A surface's grade in its band's colour, or the matrix's own N/A treatment when
 * nothing on that surface was scored — muted rather than green, because an
 * unaudited surface is not a passing one.
 */
function GradeMark({ grade, className }: { grade: SurfaceGauge["grade"]; className?: string }) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center font-semibold",
        grade ? GRADE_TINT[grade] : "bg-muted text-muted-foreground",
        className,
      )}
      aria-label={grade ? `Grade ${grade}` : "Not scored"}
    >
      {grade ?? "–"}
    </span>
  );
}
