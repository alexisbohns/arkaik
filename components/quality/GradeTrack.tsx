import type { QualityGrade } from "@arkaik/schema";
import { cn } from "@/lib/utils";

/**
 * The scale, worst-last. A constant rather than a read of the pack's bands:
 * `scales.grades` may move where each band *starts*, but the letters
 * themselves are `QualityGrade`, a closed set — and a scale that grew a sixth
 * step because a pack renamed a threshold would be a scale nobody could
 * compare across projects. Where the bands sit is the legend's job.
 */
export const GRADES: readonly QualityGrade[] = ["A", "B", "C", "D", "E"];

interface GradeTrackProps {
  grade: QualityGrade;
  /** An open Critical or High pushed this below the band its score earned. */
  capped?: boolean;
  /**
   * `sm` for a score card (the lit step says its letter only), `md` for a
   * compact line, `lg` for the cell panel's hero, where the lit step reads
   * "Grade D".
   */
  size?: "sm" | "md" | "lg";
  className?: string;
}

/**
 * A grade drawn as a position on a scale — the Nutri-Score idiom, built as
 * Material 3 Expressive's lifecycle track: five connected steps, every one
 * tinted in its own grade's hue, the one in force lifting out as a solid pill.
 * It is the node panel's status track, read for a grade, so the quality pages
 * and the panels beside them speak one shape.
 *
 * A bare letter asks the reader to already know that C is the middle and that
 * E exists at all. The track answers both in the same glance.
 *
 * `role="img"` with the sentence on it: five letters read out one at a time are
 * noise, and the steps are the grade drawn twice. The tones are
 * `data-kq-grade` attributes `app/m3/quality.css` maps to a hue, so a step, a
 * tile and a seal of one grade read as one colour in both themes.
 */
export function GradeTrack({ grade, capped = false, size = "md", className }: GradeTrackProps) {
  return (
    <span
      className={cn("kq-track", className)}
      data-size={size}
      role="img"
      aria-label={`Grade ${grade} of A to E${capped ? ", capped by an open finding" : ""}`}
    >
      {GRADES.map((step) => (
        <span key={step} className="kq-track-step" data-kq-grade={step} data-lit={step === grade || undefined}>
          {step === grade && size !== "sm" ? `Grade ${step}` : step}
        </span>
      ))}
      {capped && (
        // The mark the legend explains. Beside the track rather than beside the
        // score, because what a cap moved is the grade, not the number.
        <span className="kq-track-cap">*</span>
      )}
    </span>
  );
}
