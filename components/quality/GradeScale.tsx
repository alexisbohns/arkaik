import type { QualityGrade } from "@arkaik/schema";
import { GRADE_SOLID } from "@/components/quality/quality-styles";
import { cn } from "@/lib/utils";

/**
 * The scale, worst-last. A constant rather than a read of the pack's bands:
 * `scales.grades` may move where each band *starts*, but the letters
 * themselves are `QualityGrade`, a closed set — and a scale that grew a sixth
 * square because a pack renamed a threshold would be a scale nobody could
 * compare across projects. Where the bands sit is the legend's job.
 */
const GRADES: readonly QualityGrade[] = ["A", "B", "C", "D", "E"];

interface GradeScaleProps {
  grade: QualityGrade;
  /** An open Critical or High pushed this below the band its score earned. */
  capped?: boolean;
  /** `sm` for a card in a gallery, `md` for a panel header. */
  size?: "sm" | "md";
}

/**
 * A grade drawn as a position on a scale — the Nutri-Score / energy-label
 * idiom: every letter is shown, the one in force is filled and a size larger.
 *
 * A bare letter asks the reader to already know that C is the middle and that
 * E exists at all. The scale answers both in the same glance, and it survives
 * the card losing its background tint: the colour that used to be smeared
 * across the whole card now sits in exactly one square, where it means
 * something.
 *
 * `role="img"` with the sentence on it: five letters read out one at a time are
 * noise, and the squares are the grade drawn twice.
 */
export function GradeScale({ grade, capped = false, size = "sm" }: GradeScaleProps) {
  const base = size === "sm" ? "h-3.5 w-4 text-[9px]" : "h-4 w-5 text-[10px]";
  const lit = size === "sm" ? "h-4.5 w-5 text-[11px]" : "h-5 w-6 text-xs";

  return (
    <span
      className="flex items-center"
      role="img"
      aria-label={`Grade ${grade} of A to E${capped ? ", capped by an open finding" : ""}`}
    >
      {GRADES.map((step) => (
        <span
          key={step}
          className={cn(
            "flex items-center justify-center font-semibold leading-none first:rounded-s-sm last:rounded-e-sm",
            step === grade ? cn(lit, GRADE_SOLID[step], "rounded-sm") : cn(base, "bg-muted text-muted-foreground/70"),
          )}
        >
          {step}
        </span>
      ))}
      {capped && (
        // The mark the legend explains. Beside the scale rather than beside the
        // score, because what a cap moved is the grade, not the number.
        <span className="ms-1 text-[11px] font-medium leading-none text-muted-foreground">*</span>
      )}
    </span>
  );
}
