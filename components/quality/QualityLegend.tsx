import { gradeOf, type KritikLibrary, type QualityGrade } from "@arkaik/schema";
import { CELL_SEVERITIES, MAX_DOTS } from "@/components/quality/FindingDots";
import { GRADE_TINT, SEVERITY_DOT, SEVERITY_LABEL } from "@/components/quality/quality-styles";
import { cn } from "@/lib/utils";

/**
 * The grade bands in force, read off `gradeOf` rather than off
 * `DEFAULT_GRADE_BANDS`.
 *
 * A pack may move a band through `scales.grades`, and a legend quoting the
 * defaults would then explain the matrix with numbers the matrix does not use.
 * Walking 0–100 through the very function the cells were graded by makes that
 * impossible: the legend is a readout of the scale in force, not a second copy
 * of it.
 */
function gradeBands(library?: KritikLibrary): { grade: QualityGrade; min: number }[] {
  const lowest = new Map<QualityGrade, number>();
  for (let score = 0; score <= 100; score++) {
    const grade = gradeOf(score, library);
    if (!lowest.has(grade)) lowest.set(grade, score);
  }
  return [...lowest.entries()].map(([grade, min]) => ({ grade, min })).sort((a, b) => b.min - a.min);
}

/**
 * What the cards' colours and marks mean.
 *
 * It earns its place on one line: a grade a letter worse than its own number is
 * unexplainable without it, and the dots are colour with no key anywhere else
 * on the page.
 */
export function QualityLegend({ library }: { library?: KritikLibrary }) {
  const bands = gradeBands(library);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
      <span className="flex flex-wrap items-center gap-2">
        {bands.map((band, index) => (
          <span key={band.grade} className={cn("rounded px-1.5 py-0.5 font-medium", GRADE_TINT[band.grade])}>
            {band.grade} {band.min === 0 && index > 0 ? `below ${bands[index - 1].min}` : `${band.min}+`}
          </span>
        ))}
      </span>
      <span className="flex items-center gap-1.5">
        {CELL_SEVERITIES.map((severity) => (
          <span key={severity} className="flex items-center gap-1">
            <span className={cn("size-1.5 rounded-full", SEVERITY_DOT[severity])} aria-hidden="true" />
            {SEVERITY_LABEL[severity]}
          </span>
        ))}
        <span>· open findings, {MAX_DOTS} dots at most each</span>
      </span>
      <span>
        <span className="font-medium text-foreground">*</span> an open Critical or High finding capped this
        grade below the band its score earned
      </span>
    </div>
  );
}
