"use client";

import { useRef, type CSSProperties, type KeyboardEvent } from "react";
import { STATUSES, type StatusId } from "@/lib/config/statuses";
import { STATUS_ICONS } from "@/components/graph/nodes/node-styles";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { statusTone } from "@/components/panels/species-shape";

/**
 * A record's status as its place in the lifecycle — the seven statuses as one
 * connected shape, icons only, the current one lifting out as a labelled pill in
 * its own tone. A select says what the status is; this says where it sits.
 *
 * **A radio group, operated like one.** Roving tabindex (only the current step
 * is a tab stop) and the arrow keys, Home and End move — and choose, as a radio
 * group does. Each icon-only step names itself in a tooltip and in its
 * accessible name; the current step's label is on screen.
 *
 * **Read-only is disabled, not hidden.** A status is a fact the reader of a
 * read-only surface came to see, so without `onChange` the track still shows
 * where the record sits, and only the current step stays enabled.
 */
export function StatusTrack({
  value,
  onChange,
}: {
  value: StatusId;
  /** Absent on a read-only surface. */
  onChange?: (value: StatusId) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const disabled = !onChange;
  const index = Math.max(0, STATUSES.findIndex((status) => status.id === value));

  function move(event: KeyboardEvent, from: number) {
    const steps: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    let next: number | null = null;
    if (event.key in steps) next = (from + steps[event.key] + STATUSES.length) % STATUSES.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = STATUSES.length - 1;
    if (next === null) return;
    event.preventDefault();
    if (disabled) return;
    onChange(STATUSES[next].id);
    refs.current[next]?.focus();
  }

  return (
    <div role="radiogroup" aria-label="Status" aria-disabled={disabled || undefined} className="np-connected np-track">
      {STATUSES.map((status, i) => {
        const chosen = i === index;
        const Icon = STATUS_ICONS[status.id];
        const step = (
          <button
            key={status.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={chosen}
            aria-label={status.label}
            tabIndex={chosen ? 0 : -1}
            disabled={disabled && !chosen}
            aria-disabled={disabled || undefined}
            onClick={() => !disabled && onChange(status.id)}
            onKeyDown={(event) => move(event, i)}
            style={{ "--np-tone": statusTone(status.id) } as CSSProperties}
          >
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            {chosen && <span className="np-connected-label truncate">{status.label}</span>}
          </button>
        );
        // The current step shows its label; the others name themselves on hover.
        if (chosen) return step;
        return (
          <Tooltip key={status.id}>
            <TooltipTrigger asChild>{step}</TooltipTrigger>
            <TooltipContent side="bottom">{status.label}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
