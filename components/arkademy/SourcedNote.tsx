"use client";

import { InfoIcon } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { noteDate } from "@/lib/arkademy/paragraph";
import type { UseNote } from "@/lib/arkademy/schema";

const SOURCE_LINK =
  "rounded-sm underline decoration-dotted underline-offset-2 outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50";

/**
 * A note's content: its text, then "Source:" in plain words, the source's name
 * as a link (new tab, nofollow), then the date — `text. Source: Name,
 * 2026-03-02`, or `…, read on 2026-10-01` for an undated page. Its text
 * content is exactly `noteText(note)`. Inline spans, so a flex column (the
 * card) stacks them and plain text (the no-script fallback) runs them on.
 */
export function NoteContent({ note }: { note: UseNote }) {
  return (
    <>
      <span>{note.text}.</span>{" "}
      <span>
        Source:{" "}
        <a href={note.source.url} target="_blank" rel="noopener noreferrer nofollow" className={SOURCE_LINK}>
          {note.source.name}
        </a>
        , {noteDate(note)}
      </span>
    </>
  );
}

/**
 * A sourced note, behind a click: a small, quiet marker placed right after its
 * answer, which opens a card holding `NoteContent`. The running text keeps no
 * note words, no parentheses.
 *
 * The card is the app's Popover (Radix): it opens on click, Enter or Space
 * (a real button) and on touch, closes on Escape and on an outside click, and
 * gives focus back to the marker. The marker's name is "Source note for
 * <answer>"; its icon is hidden from assistive technology, so it adds no text.
 *
 * Without JavaScript the marker does nothing, so a `<noscript>` after it holds
 * the note in parentheses, in place: a no-script visitor reads the source
 * inline, and a crawler finds the note and its link in the server HTML. With
 * JavaScript the browser never renders it, and React does not hydrate it.
 *
 * A client component. `ParagraphView` and `CanvasGrid` stay server-renderable
 * without "use client": a server page renders them, and each marker is a
 * client island whose props (`note`, `answer`) are plain JSON.
 */
export function SourcedNote({ note, answer }: { note: UseNote; answer: string }) {
  return (
    <>
      <Popover>
        <PopoverTrigger
          data-note-marker=""
          aria-label={`Source note for ${answer}`}
          className="relative ml-0.5 inline-flex size-[1.05em] cursor-pointer items-center justify-center rounded-full align-[-0.15em] text-muted-foreground outline-none after:absolute after:-inset-1.5 after:content-[''] hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=open]:text-foreground"
        >
          <InfoIcon aria-hidden="true" className="size-full" />
        </PopoverTrigger>
        <PopoverContent className="flex w-72 max-w-[calc(100vw-2rem)] flex-col gap-1 text-sm leading-relaxed break-words">
          <NoteContent note={note} />
        </PopoverContent>
      </Popover>
      <noscript>
        {" ("}
        <span className="text-[0.875em] text-muted-foreground">
          <NoteContent note={note} />
        </span>
        {")"}
      </noscript>
    </>
  );
}
