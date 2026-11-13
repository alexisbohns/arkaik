import { CircleDashedIcon } from "lucide-react";
import { Fragment, type CSSProperties, type ReactNode } from "react";

import { SourcedNote } from "@/components/arkademy/SourcedNote";
import type { ParagraphSegment } from "@/lib/arkademy/paragraph";
import type { BmcQuestionKey } from "@/lib/arkademy/schema";
import { isWord, splitWords, wordTurn } from "@/lib/arkademy/tour-stage";
import { cn } from "@/lib/utils";

interface ParagraphViewProps {
  /** From `composeParagraph`. */
  segments: readonly ParagraphSegment[];
  /**
   * Your own canvas (part 4): each gap becomes a button that goes to its
   * question. Without it gaps are plain text, as on the cover and the tour.
   */
  onSelectQuestion?: (question: BmcQuestionKey) => void;
  /**
   * The tour's end: each word (each gap pill, each note marker) in a
   * `.mx-word` span whose `--mx-word-at` is its turn (`wordTurn`: words
   * arrive in runs of `runSize`, one run every `runMs`), for the tour's
   * stylesheet to fade in as a flow. The words sit inside
   * their sentence's span, so the paragraph–canvas link is untouched; each
   * run of words is hidden from assistive technology and read whole from a
   * visually hidden copy beside it, so a screen reader never meets it word by
   * word. Without it (the cover, your own canvas) nothing is split.
   */
  words?: { start: number; runSize: number; runMs: number };
  className?: string;
}

/** A word's turn, for the tour's stylesheet. */
function turn(at: number): CSSProperties {
  return { "--mx-word-at": `${at}ms` } as CSSProperties;
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
export function ParagraphView({ segments, onSelectQuestion, words, className }: ParagraphViewProps) {
  // The running count of words, across sentences, gaps and markers.
  let n = 0;
  const next = () => (words ? wordTurn(words, n++) : 0);
  /** A run of a sentence's text: as it is, or split into words with a whole copy for assistive technology. */
  const textRun = (text: string, key: number): ReactNode => {
    if (!words) return <Fragment key={key}>{text}</Fragment>;
    return (
      <Fragment key={key}>
        <span className="sr-only">{text}</span>
        <span aria-hidden="true">
          {splitWords(text).map((piece, j) =>
            isWord(piece) ? (
              <span key={j} className="mx-word" style={turn(next())}>
                {piece}
              </span>
            ) : (
              <Fragment key={j}>{piece}</Fragment>
            ),
          )}
        </span>
      </Fragment>
    );
  };
  /** A gap pill or a note marker: one word's turn, whole. */
  const asWord = (node: ReactNode, key?: number): ReactNode =>
    words ? (
      <span key={key} className="mx-word" style={turn(next())}>
        {node}
      </span>
    ) : (
      node
    );
  return (
    <p className={cn("text-[15px] leading-7 break-words text-foreground", className)}>
      {segments.map((segment, i) => (
        <Fragment key={segment.question}>
          {i > 0 && " "}
          {segment.kind === "sentence" ? (
            <span data-question={segment.question} data-kind="sentence">
              {segment.parts.map((part, j) =>
                part.kind === "text"
                  ? textRun(part.text, j)
                  : asWord(<SourcedNote key={j} note={part.note} answer={part.answer} />, j),
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
            asWord(
              <span
                data-question={segment.question}
                data-kind="gap"
                className={cn(GAP, segment.open ? GAP_OPEN_ON_PURPOSE : GAP_UNANSWERED)}
              >
                <GapText open={segment.open} text={segment.text} />
              </span>,
            )
          )}
        </Fragment>
      ))}
    </p>
  );
}
