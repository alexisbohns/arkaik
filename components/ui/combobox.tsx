"use client";

import { useEffect, useId, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { SearchInput } from "@/components/ui/search-input";
import { cn } from "@/lib/utils";

/**
 * The repo's type-ahead: a text field that suggests rows and lets the keyboard
 * pick one. Hand-rolled twice before this existed (audit `shadcn-6`) — once in
 * `NodeSearchCombobox`, once in `MapEditorDialog`'s anchor picker — and both
 * copies shipped a bare `<input>` with a `<div>` of buttons under it: no
 * `role`, no `aria-expanded`, no `aria-activedescendant`, and arrows, Enter and
 * Escape all inert. The list could only be reached with a mouse.
 *
 * The roles and the arrow plumbing are lifted from `CommandPalette`, which had
 * the contract right all along; this is that dialect made reusable rather than
 * a second one. What is *not* lifted is the palette's inline ghost completion
 * (hence `aria-autocomplete="list"`, not `"both"`) and its Home/End override: a
 * palette input is the only control in its overlay, whereas these fields sit in
 * forms where Home and End still have to move the caret through a typed query.
 *
 * **The call site owns the look, this owns the behaviour.** `renderItem` fills
 * the row and `itemClassName` styles it — including the highlight, because the
 * two call sites tint their rows differently and converging them would be a
 * restyle, not the accessibility fix this is. What the component keeps for
 * itself is the option element, its `id`, and its selected state, which is
 * exactly the part that was missing.
 */

interface ComboboxProps<T> {
  /** The text in the field. Controlled: filtering belongs to the call site. */
  value: string;
  onValueChange: (value: string) => void;
  /** The rows to offer, already filtered, in the order the arrows walk them. */
  items: readonly T[];
  /** Stable identity for the React key. */
  itemKey: (item: T) => string;
  /** The contents of one row. */
  renderItem: (item: T) => React.ReactNode;
  /** Chosen by Enter or by click. The list closes either way. */
  onSelect: (item: T) => void;
  /** Classes for one row, told whether it is the highlighted one. */
  itemClassName?: (item: T, active: boolean) => string;
  /**
   * Shown in place of the rows when nothing matches. Omitted means the list
   * does not appear at all while empty — a picker that only ever offers
   * existing rows has nothing to say about a query that finds none.
   */
  empty?: React.ReactNode;
  placeholder?: string;
  /** Names the field: it has no visible label at either call site. */
  "aria-label": string;
  /** `id` of the text field, so a `<Field htmlFor>` can point at it. */
  id?: string;
  disabled?: boolean;
  /** Render the field as the shared `SearchInput` — magnifier inside the box. */
  search?: boolean;
  /** `popover` floats the list over what follows; `inline` pushes it down. */
  placement?: "popover" | "inline";
  /** Replaces (does not merge with) the default classes of the scrolling list. */
  listClassName?: string;
  /** Classes for the root wrapper — width, and the inline gap under the field. */
  className?: string;
}

export function Combobox<T>({
  value,
  onValueChange,
  items,
  itemKey,
  renderItem,
  onSelect,
  itemClassName,
  empty,
  placeholder,
  "aria-label": ariaLabel,
  id,
  disabled,
  search = false,
  placement = "popover",
  listClassName = "max-h-60 overflow-y-auto p-1",
  className,
}: ComboboxProps<T>) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  // The list re-filters under the highlight on every keystroke, so the stored
  // index is clamped at read time rather than corrected on the way in: that
  // covers the shrink a call site causes on its own too — a freshly created node
  // dropping out of its own candidate list, say — without a reset effect.
  const clampedIndex = items.length === 0 ? -1 : Math.min(activeIndex, items.length - 1);
  const activeItem = clampedIndex < 0 ? undefined : items[clampedIndex];
  const showList = open && (items.length > 0 || empty != null);

  useEffect(() => {
    if (!showList) return;

    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current) return;
      if (rootRef.current.contains(event.target as Node)) return;
      setOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [showList]);

  /**
   * Escape is claimed here, on `window` in the capture phase, rather than in the
   * field's own `onKeyDown` — and that placement is the whole point. Radix's
   * dismissable layer listens for Escape on `document` with `capture: true`, so
   * a handler on the input runs far too late to stop a dialog from closing under
   * a combobox that only wanted to close its list (`InsertBetweenDialog` and
   * `MapEditorDialog` both put one there). `window` is the first object on the
   * capture path, ahead of `document`, so stopping propagation here is what
   * makes "Escape dismisses the suggestions, Escape again closes the dialog"
   * true. Scoped to events aimed inside this widget, so an Escape meant for
   * anything else passes straight through.
   */
  useEffect(() => {
    if (!showList) return;

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
  }, [showList]);

  // `nearest` so a row already on screen never yanks the page around.
  useEffect(() => {
    if (!showList) return;
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [clampedIndex, showList, items.length]);

  function move(delta: number) {
    if (items.length === 0) return;
    // Wrapping rather than clamping, like the command palette: it keeps one
    // dialect for "next suggestion" in the app, and it puts the last row one
    // ArrowUp away from the field instead of a full traversal.
    setActiveIndex((current) => {
      const from = Math.min(current, items.length - 1);
      return (from + delta + items.length) % items.length;
    });
  }

  function updateValue(next: string) {
    // Typing re-opens a list dismissed with Escape, and sends the highlight back
    // to the top so Enter always validates the best answer to what is typed.
    setOpen(true);
    setActiveIndex(0);
    onValueChange(next);
  }

  function select(item: T) {
    setOpen(false);
    setActiveIndex(0);
    onSelect(item);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp":
        // Claimed even when the list is shut, where they re-open it: letting an
        // arrow through would jump the caret to one end of the query instead.
        event.preventDefault();
        if (!open) {
          setOpen(true);
          setActiveIndex(0);
          return;
        }
        move(event.key === "ArrowDown" ? 1 : -1);
        return;
      case "Enter":
        // With nothing highlighted the key is not ours: an enclosing form or
        // dialog keeps whatever Enter already meant there.
        if (!showList || !activeItem) return;
        event.preventDefault();
        select(activeItem);
        return;
      case "Tab":
        // Deliberately no `preventDefault`: Tab still means "leave this field",
        // it just leaves the suggestions behind instead of taking one.
        setOpen(false);
        return;
      default:
    }
  }

  const fieldProps = {
    ref: inputRef,
    id,
    value,
    placeholder,
    disabled,
    role: "combobox" as const,
    "aria-label": ariaLabel,
    "aria-expanded": showList,
    "aria-controls": showList ? listId : undefined,
    "aria-autocomplete": "list" as const,
    "aria-activedescendant": showList && activeItem ? `${listId}-${clampedIndex}` : undefined,
    // The browser's own autofill panel would otherwise open over the rows.
    autoComplete: "off",
    onFocus: () => setOpen(true),
    onKeyDown: handleKeyDown,
  };

  const list = showList ? (
    <div
      ref={listRef}
      id={listId}
      role="listbox"
      // The field's own name describes what is being searched; the list is just
      // where the answers land, and reading the same sentence twice helps nobody.
      aria-label="Suggestions"
      data-slot="combobox-list"
      className={listClassName}
      // Rows are `<div>`s, so a mousedown on one would blur the field and park
      // focus on `<body>` for the instant before the list unmounts. Refusing the
      // default keeps focus in the field across the whole gesture.
      onMouseDown={(event) => event.preventDefault()}
    >
      {items.length === 0
        ? empty
        : items.map((item, index) => {
            const active = index === clampedIndex;

            return (
              <div
                key={itemKey(item)}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={active}
                data-active={active}
                // Pointer and keyboard share the one highlight, so hovering the
                // third row while the arrows sit on the first cannot light both.
                onPointerMove={() => setActiveIndex(index)}
                onClick={() => select(item)}
                className={cn("cursor-pointer", itemClassName?.(item, active))}
              >
                {renderItem(item)}
              </div>
            );
          })}
    </div>
  ) : null;

  return (
    <div
      ref={rootRef}
      data-slot="combobox"
      className={cn("relative w-full", placement === "inline" && "flex flex-col", className)}
    >
      {search ? (
        <SearchInput onChange={updateValue} {...fieldProps} />
      ) : (
        <Input onChange={(event) => updateValue(event.target.value)} {...fieldProps} />
      )}
      {placement === "popover"
        ? list && (
            <div className="absolute z-30 mt-1 w-full rounded-md border border-border bg-popover shadow-md">
              {list}
            </div>
          )
        : list}
    </div>
  );
}
