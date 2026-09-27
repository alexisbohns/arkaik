"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { CheckIcon, XIcon } from "lucide-react";

import type { ValueId } from "@arkaik/schema";
import { VALUES, VALUE_TIERS_CONFIG } from "@/lib/config/values";
import { VALUE_ICON_COMPONENTS } from "@/lib/config/value-icons";
import { cn } from "@/lib/utils";

interface ValuePickerProps {
  selected: ValueId[];
  onChange: (next: ValueId[]) => void;
}

const TIER_LABEL = new Map(VALUE_TIERS_CONFIG.map((tier) => [tier.id, tier.label]));

/** The tier order the grouped list walks — `VALUE_TIERS_CONFIG`'s own. */
const TIER_ORDER = VALUE_TIERS_CONFIG.map((tier) => tier.id);

/**
 * The 30 Bain value elements, as a multi-select combobox.
 *
 * It used to be all 30 chips laid out flat under four tier headings, which is
 * roughly 300px of an acceptance panel spent on a field most acceptances answer
 * with two or three values. A combobox inverts that: what is *chosen* is always
 * on screen, stacked inside the field, and the other 27 appear only while you
 * are choosing.
 *
 * The chips stay inside the box rather than sitting under it, because that is
 * what makes the field's height the answer's height — an acceptance with one
 * value costs one line. Each chip removes itself with its own ×, and Backspace
 * on an empty query removes the last one, which is the gesture people already
 * have for token fields.
 *
 * The tier is a heading inside the list, never a filter: the tiers are how the
 * model is *taught*, and a reader who knows they want "Saves time" should type
 * it without first deciding which tier Bain filed it under. Typing therefore
 * matches on the label and on the definition, and empty tiers simply do not
 * render.
 *
 * `onChange` re-derives the array from `VALUES` order rather than appending, so
 * the stored list reads in the model's canonical order no matter what order the
 * values were picked in — the behaviour the chip grid had, kept.
 */
export function ValuePicker({ selected, onChange }: ValuePickerProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  // Every value, selected or not — picking one must not make it vanish from
  // under the pointer, and the check mark is what reports its state.
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return VALUES;
    return VALUES.filter(
      (value) =>
        value.label.toLowerCase().includes(needle) ||
        value.description.toLowerCase().includes(needle),
    );
  }, [query]);

  // The flat list the arrows walk, and the grouping the eye reads, derived from
  // one array so a highlight can never land on a row the groups do not show.
  const groups = useMemo(() => {
    let cursor = 0;
    return TIER_ORDER.map((tier) => {
      const items = matches
        .filter((value) => value.tier === tier)
        .map((value) => ({ value, index: cursor++ }));
      return { tier, items };
    }).filter((group) => group.items.length > 0);
  }, [matches]);

  const clampedIndex = matches.length === 0 ? -1 : Math.min(activeIndex, matches.length - 1);
  // `matches` is the arrows' order only because `groups` is built by walking it
  // in tier order; the flat index therefore has to be read back through the
  // groups rather than out of `matches` directly.
  const activeValue = groups.flatMap((group) => group.items).find((row) => row.index === clampedIndex)
    ?.value;

  // `nearest` so a row already on screen never yanks the list around.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [clampedIndex, open, matches.length]);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  /**
   * Escape is claimed on `window` in the capture phase, for the reason
   * `components/ui/combobox.tsx` spells out at length: Radix's dismissable layer
   * listens on `document` with `capture: true`, and the panel stack claims
   * Escape too, so a handler on the input runs far too late to stop the whole
   * panel closing under a list that only wanted to shut.
   */
  useEffect(() => {
    if (!open) return;

    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (!rootRef.current?.contains(event.target as Node)) return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      inputRef.current?.focus();
    }

    window.addEventListener("keydown", handleEscape, { capture: true });
    return () => window.removeEventListener("keydown", handleEscape, { capture: true });
  }, [open]);

  function commit(next: Set<ValueId>) {
    onChange(VALUES.filter((value) => next.has(value.id)).map((value) => value.id));
  }

  function toggle(id: ValueId) {
    const next = new Set(selectedSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    commit(next);
  }

  function remove(id: ValueId) {
    const next = new Set(selectedSet);
    next.delete(id);
    commit(next);
  }

  function move(delta: number) {
    if (matches.length === 0) return;
    setActiveIndex((current) => {
      const from = Math.min(current, matches.length - 1);
      return (from + delta + matches.length) % matches.length;
    });
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp":
        event.preventDefault();
        if (!open) {
          setOpen(true);
          setActiveIndex(0);
          return;
        }
        move(event.key === "ArrowDown" ? 1 : -1);
        return;
      case "Enter":
        if (!open || !activeValue) return;
        event.preventDefault();
        // The list stays open and the query stays put: choosing values is a
        // run of picks, not one, and re-opening the list between each would
        // make the common case the expensive one.
        toggle(activeValue.id);
        return;
      case "Backspace": {
        if (query !== "") return;
        const last = selected[selected.length - 1];
        if (last === undefined) return;
        event.preventDefault();
        remove(last);
        return;
      }
      case "Tab":
        setOpen(false);
        return;
      default:
    }
  }

  return (
    <div ref={rootRef} className="relative flex flex-col">
      {/* The field itself — a box that *contains* the answer. It borrows
          `Input`'s border, radius and focus ring by hand rather than wrapping an
          `Input`, because the chips have to live inside the same box as the
          text caret and no single `<input>` can hold both. */}
      <div
        onClick={() => {
          setOpen(true);
          inputRef.current?.focus();
        }}
        className={cn(
          "flex min-h-9 w-full cursor-text flex-wrap items-center gap-1 rounded-md border border-input bg-transparent px-2 py-1.5 text-sm shadow-xs transition-[color,box-shadow]",
          "focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
        )}
      >
        {selected.map((id) => {
          const value = VALUES.find((candidate) => candidate.id === id);
          if (!value) return null;
          const Icon = VALUE_ICON_COMPONENTS[id];
          return (
            <span
              key={id}
              className="inline-flex items-center gap-1 rounded-full border border-foreground bg-foreground px-2 py-0.5 text-[11px] text-background"
            >
              <Icon className="size-3" />
              {value.label}
              <button
                type="button"
                aria-label={`Remove ${value.label}`}
                // The box's own click would re-focus the field and re-open the
                // list; removing a chip is a complete gesture on its own.
                onClick={(event) => {
                  event.stopPropagation();
                  remove(id);
                }}
                className="cursor-pointer rounded-full opacity-70 hover:opacity-100"
              >
                <XIcon className="size-3" />
              </button>
            </span>
          );
        })}
        <input
          ref={inputRef}
          value={query}
          role="combobox"
          aria-label="Values"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={open && activeValue ? `${listId}-${clampedIndex}` : undefined}
          autoComplete="off"
          placeholder={selected.length === 0 ? "Search the value elements…" : ""}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          onChange={(event) => {
            setOpen(true);
            setActiveIndex(0);
            setQuery(event.target.value);
          }}
          className="min-w-24 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
        />
      </div>

      {open && (
        <div className="absolute top-full z-30 mt-1 w-full rounded-md border border-border bg-popover shadow-md">
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label="Value elements"
            aria-multiselectable
            className="max-h-64 overflow-y-auto p-1"
            // Rows are `<div>`s, so a mousedown on one would blur the field and
            // park focus on `<body>`; refusing the default keeps the caret here
            // across a whole run of picks.
            onMouseDown={(event) => event.preventDefault()}
          >
            {groups.length === 0 ? (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">
                No value element matches &ldquo;{query.trim()}&rdquo;.
              </p>
            ) : (
              groups.map((group) => (
                <div key={group.tier} className="flex flex-col">
                  <span className="px-2 pt-1.5 pb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                    {TIER_LABEL.get(group.tier)}
                  </span>
                  {group.items.map(({ value, index }) => {
                    const Icon = VALUE_ICON_COMPONENTS[value.id];
                    const on = selectedSet.has(value.id);
                    const active = index === clampedIndex;
                    return (
                      <div
                        key={value.id}
                        id={`${listId}-${index}`}
                        role="option"
                        aria-selected={on}
                        data-active={active}
                        onPointerMove={() => setActiveIndex(index)}
                        onClick={() => toggle(value.id)}
                        className={cn(
                          "flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm",
                          active && "bg-muted",
                        )}
                      >
                        <CheckIcon className={cn("size-3.5 shrink-0", !on && "opacity-0")} />
                        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="shrink-0">{value.label}</span>
                        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                          {value.description}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
