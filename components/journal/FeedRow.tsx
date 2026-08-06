"use client";

import type { ReactNode } from "react";
import { LightbulbIcon, MessageSquareTextIcon } from "lucide-react";

import { describeJournalEvent, formatEventDate } from "@/components/journal/describe-event";
import type { Backlog } from "@/lib/utils/journal";
import type { JournalEvent, Node } from "@/lib/data/types";

/**
 * The journal row markup, in one place at last (audit `factorization-4`).
 *
 * `describe-event.ts` beside this file already centralized the hard part — what
 * an event *says* — and then three surfaces forked the ten lines that render it:
 * the changelog's `FeedRow`, the history page's inline map body, and
 * `NodeDetailPanel`'s History section. This is the changelog's version moved
 * verbatim, because it is the superset: the other two are it without `trailing`
 * and without `onOpen`.
 *
 * `BacklogItemRow` lives here rather than in `components/overview/` for the same
 * reason — `BacklogCard` and the changelog's `BacklogList` render the same
 * idea/request row, down to the Lightbulb/MessageSquareText ternary and the
 * "Idea"/"Request" trailing label.
 */

interface FeedRowProps {
  event: JournalEvent;
  nodesById: Map<string, Node>;
  /** Extra content before the timestamp — a status badge, a platform chip. */
  trailing?: ReactNode;
  /** Makes the row a button. Decisions use it to deep-link to their node. */
  onOpen?: () => void;
}

/** A commitment or decision feed row. Clickable when `onOpen` is given. */
export function FeedRow({ event, nodesById, trailing, onOpen }: FeedRowProps) {
  const { icon: Icon, text, meta } = describeJournalEvent(event, nodesById);

  const content = (
    <>
      <Icon className="size-3.5 shrink-0 text-muted-foreground mt-0.5" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <p className="truncate">{text}</p>
        {meta && <p className="text-xs text-muted-foreground truncate">{meta}</p>}
      </div>
      {trailing}
      <span className="text-xs text-muted-foreground shrink-0">{formatEventDate(event.ts)}</span>
    </>
  );

  if (onOpen) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="flex items-start gap-2 rounded-md px-2 py-1.5 text-sm text-left w-full cursor-pointer hover:bg-muted/50 transition-colors"
      >
        {content}
      </button>
    );
  }

  return <div className="flex items-start gap-2 rounded-md px-2 py-1.5 text-sm">{content}</div>;
}

interface BacklogItemRowProps {
  item: Backlog["items"][number];
  /**
   * Second line under the title. Off for the overview's `BacklogCard`, which
   * caps the card at five one-line rows and sends the reader to the changelog
   * for the detail.
   */
  showDescription?: boolean;
}

/** One open idea or request — the backlog's row, bordered rather than hover-lit. */
export function BacklogItemRow({ item, showDescription = true }: BacklogItemRowProps) {
  const Icon = item.type === "idea.proposed" ? LightbulbIcon : MessageSquareTextIcon;

  return (
    <div className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm">
      <Icon className="size-3.5 shrink-0 text-muted-foreground mt-0.5" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <p className="truncate font-medium">{item.title}</p>
        {showDescription && item.description && (
          <p className="text-xs text-muted-foreground truncate">{item.description}</p>
        )}
      </div>
      <span className="text-xs text-muted-foreground shrink-0">
        {item.type === "idea.proposed" ? "Idea" : "Request"}
      </span>
    </div>
  );
}
