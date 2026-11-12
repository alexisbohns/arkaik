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
 * A canvas read back as one paragraph: sentences as inline text, a small
 * marker after each answer that has a note (`SourcedNote`: the note opens in a
 * card on click; no note words in the running text), and each question
 * without answers as an inline dashed pill — "left open on purpose: …" plain,
 * "open: …" on a muted fill. Its text, gaps and no-script fallbacks aside, is
 * exactly `paragraphText`.
 *
 * No hooks and no "use client": the cover renders it on the server (each
 * marker is a client island); a client screen (the tour, your own canvas)
 * renders it with handlers. It sets no width: the caller's `className` does.
 */
export function ParagraphView({ segments, onSelectQuestion, className }: ParagraphViewProps) {
  return (
    <p className={cn("text-[15px] leading-7 break-words text-foreground", className)}>
      {segments.map((segment, i) => (
        <Fragment key={segment.question}>
          {i > 0 && " "}
          {segment.kind === "sentence" ? (
            <span data-question={segment.question} data-kind="sentence">
              {segment.parts.map((part, j) =>
                part.kind === "text" ? (
                  <Fragment key={j}>{part.text}</Fragment>
                ) : (
                  <SourcedNote key={j} note={part.note} answer={part.answer} />
                ),
              )}
            </span>
          ) : onSelectQuestion ? (
            <button
              type="button"
              data-question={segment.question}
              data-kind="gap"
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
            <span data-question={segment.question} data-kind="gap" className={cn(GAP, !segment.open && "bg-muted")}>
              {segment.text}
            </span>
          )}
        </Fragment>
      ))}
    </p>
  );
}
