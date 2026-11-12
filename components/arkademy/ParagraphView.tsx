import { CircleDashedIcon } from "lucide-react";
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

/**
 * A gap pill. An inline block capped at the line's width: it moves to the next
 * line whole rather than breaking mid-phrase, and wraps inside only when it is
 * longer than a line (a phone), so it never overflows. Its text is the
 * foreground at 65%, which passes 4.5:1 on the card and on the muted fill in
 * both themes (muted-foreground on the muted fill measured 4.40:1).
 */
const GAP = "inline-block max-w-full rounded-md border px-1.5 text-[0.875em] leading-6 text-foreground/65";
/**
 * Left open on purpose: a dashed border, no fill, and a dashed-circle icon.
 * Not answered yet: a solid muted fill and no visible border. Shape and icon,
 * not only a fill, tell them apart.
 */
const GAP_OPEN_ON_PURPOSE = "border-dashed border-muted-foreground/45";
const GAP_UNANSWERED = "border-transparent bg-muted";

function GapText({ open, text }: { open: boolean; text: string }) {
  return (
    <>
      {open && <CircleDashedIcon aria-hidden="true" className="mr-1 inline size-[0.95em] align-[-0.125em]" />}
      {text}
    </>
  );
}

/**
 * A canvas read back as one paragraph: sentences as inline text, a small
 * marker after each answer that has a note (`SourcedNote`: the note opens in a
 * card on click; no note words in the running text), and each question
 * without answers as an inline pill — "left open on purpose: …" with a dashed
 * border and a dashed-circle icon, "open: …" as a solid muted chip. Its text, gaps and no-script fallbacks aside, is
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
                segment.open ? GAP_OPEN_ON_PURPOSE : GAP_UNANSWERED,
                "cursor-pointer text-left outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50",
              )}
            >
              <GapText open={segment.open} text={segment.text} />
            </button>
          ) : (
            <span
              data-question={segment.question}
              data-kind="gap"
              className={cn(GAP, segment.open ? GAP_OPEN_ON_PURPOSE : GAP_UNANSWERED)}
            >
              <GapText open={segment.open} text={segment.text} />
            </span>
          )}
        </Fragment>
      ))}
    </p>
  );
}
