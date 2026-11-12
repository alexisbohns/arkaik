import { Fragment } from "react";

import { SourcedNote } from "@/components/arkademy/SourcedNote";
import type { ParagraphSegment } from "@/lib/arkademy/paragraph";
import type { BmcQuestionKey } from "@/lib/arkademy/schema";
import { cn } from "@/lib/utils";

interface ParagraphViewProps {
  /** From `composeParagraph`. */
  segments: readonly ParagraphSegment[];
  /**
   * Your own canvas (part 4): each gap becomes a button that goes to its
   * question. Without it gaps are plain text, as on the cover and the tour.
   */
  onSelectQuestion?: (question: BmcQuestionKey) => void;
  className?: string;
}

const GAP =
  "rounded-md border border-dashed border-muted-foreground/45 px-1.5 text-[0.875em] text-muted-foreground box-decoration-clone";

/**
 * A canvas read back as one paragraph: sentences as inline text, each note in
 * smaller muted type inside its parentheses with the source as a link, and
 * each question without answers as an inline dashed pill — "left open on
 * purpose: …" plain, "open: …" on a muted fill.
 *
 * No hooks and no "use client": the cover renders it on the server; a client
 * screen (the tour, your own canvas) renders it with handlers.
 */
export function ParagraphView({ segments, onSelectQuestion, className }: ParagraphViewProps) {
  return (
    <p className={cn("text-[15px] leading-7 break-words text-foreground", className)}>
      {segments.map((segment, i) => (
        <Fragment key={segment.question}>
          {i > 0 && " "}
          {segment.kind === "sentence" ? (
            <span data-question={segment.question}>
              {segment.parts.map((part, j) =>
                part.kind === "text" ? (
                  <Fragment key={j}>{part.text}</Fragment>
                ) : (
                  <span key={j} className="text-[0.875em] text-muted-foreground">
                    <SourcedNote note={part.note} />
                  </span>
                ),
              )}
            </span>
          ) : onSelectQuestion ? (
            <button
              type="button"
              data-question={segment.question}
              onClick={() => onSelectQuestion(segment.question)}
              className={cn(
                GAP,
                !segment.open && "bg-muted",
                "cursor-pointer text-left outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50",
              )}
            >
              {segment.text}
            </button>
          ) : (
            <span data-question={segment.question} className={cn(GAP, !segment.open && "bg-muted")}>
              {segment.text}
            </span>
          )}
        </Fragment>
      ))}
    </p>
  );
}
