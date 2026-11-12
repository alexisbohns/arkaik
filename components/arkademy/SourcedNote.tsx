import { noteDate } from "@/lib/arkademy/paragraph";
import type { UseNote } from "@/lib/arkademy/schema";

/**
 * A note's content, inline: its text, the source's name as a link, the date —
 * `text; Source, 2026-03-02` or `…, read on 2026-10-01`. Its text content is
 * exactly `noteText(note)`. The paragraph sets it inside parentheses; the
 * canvas grid's full density puts it under its answer.
 */
export function SourcedNote({ note }: { note: UseNote }) {
  return (
    <>
      {note.text};{" "}
      <a
        href={note.source.url}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="rounded-sm underline decoration-dotted underline-offset-2 outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {note.source.name}
      </a>
      , {noteDate(note)}
    </>
  );
}
