"use client";

import { useRef, useState, type ReactNode } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * A popover that opens on hover where there is a pointer, and on tap where
 * there is not.
 *
 * `HoverCard` is the app's usual answer for "preview this without navigating"
 * — `DeliverableHoverCard` is one — and on a touch screen it is unreachable:
 * there is no hover, so the content simply never exists. A plain `Popover` is
 * reachable everywhere but costs a click on a desktop, where the gesture the
 * reader already makes is to point at the thing. This is both: one controlled
 * `Popover`, opened by whichever gesture the device actually has.
 *
 * **The pointer type decides, not a breakpoint.** `useIsMobile` answers "is the
 * window narrow", which is a different question — a narrow desktop window has a
 * mouse and a wide tablet has none. `PointerEvent.pointerType` answers the one
 * that matters, per event, and a hybrid device gets the right behaviour from
 * whichever input it used last rather than from the one it was holding at
 * mount.
 *
 * **A tap must not also be a hover.** Touch browsers synthesise pointer events
 * before the click, so `pointerType === "mouse"` is the guard on both the enter
 * and the leave: without it a tap opens on `pointerenter`, then the click
 * arrives and toggles it shut again.
 *
 * **Closing is deferred by a frame's worth of grace.** The content sits
 * `sideOffset` px off the trigger, so a pointer travelling into it crosses a
 * gap that belongs to neither; closing immediately on `pointerleave` makes the
 * popover impossible to reach. The timer is cancelled by an enter on either
 * half.
 */
const CLOSE_GRACE_MS = 120;

export function HoverPopover({
  trigger,
  children,
  align = "start",
  side = "bottom",
  className,
}: {
  /** The control that opens it. Rendered as the trigger itself — `asChild`. */
  trigger: ReactNode;
  children: ReactNode;
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Whether the pointer opened this, which decides where focus goes when it
   * shuts. Radix returns focus to the trigger on close, which is right for a
   * popover somebody *clicked* — and wrong for one they merely pointed at:
   * a chip they passed over is left wearing a focus ring, and the caret has
   * silently moved out of wherever they were.
   */
  const openedByHover = useRef(false);

  function cancelClose() {
    if (closeTimer.current === null) return;
    clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }

  function scheduleClose() {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_GRACE_MS);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        cancelClose();
        // Every path through here — a click, Escape, a click outside — is a
        // deliberate gesture rather than a pointer passing by, so the flag
        // clears and Radix's usual focus return stands. A hover open and a
        // hover close both set the state directly and never reach this.
        openedByHover.current = false;
        setOpen(next);
      }}
    >
      <PopoverTrigger
        asChild
        onPointerEnter={(event) => {
          if (event.pointerType !== "mouse") return;
          cancelClose();
          openedByHover.current = true;
          setOpen(true);
        }}
        onPointerLeave={(event) => {
          if (event.pointerType !== "mouse") return;
          scheduleClose();
        }}
      >
        {trigger}
      </PopoverTrigger>
      <PopoverContent
        align={align}
        side={side}
        className={cn("w-72", className)}
        // Hover opened it, so hover must not steal the caret: without this the
        // panel grabs focus the moment a pointer crosses the trigger, and the
        // reader's place on the page is gone. A keyboard user still opens it
        // with Enter and still tabs into it.
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => {
          if (openedByHover.current) event.preventDefault();
        }}
        onPointerEnter={cancelClose}
        onPointerLeave={(event) => {
          if (event.pointerType !== "mouse") return;
          scheduleClose();
        }}
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}
