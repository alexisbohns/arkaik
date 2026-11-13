"use client";

import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react";

import { cn } from "@/lib/utils";

function Select({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />;
}

function SelectGroup({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />;
}

function SelectValue({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />;
}

function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        // M3 Expressive (app/m3/controls.css): a tonal pill, no stroke. A press
        // tightens the corners; while the list is open the trigger settles
        // into a squarer shape on the "on" fill and its chevron turns over.
        // The pill is `--m3-pill` (20px), never `rounded-full`: a spring from
        // 9999px to 12px undershoots zero and flashes square. Open is read off
        // aria-expanded, which a wrapping TooltipTrigger cannot overwrite.
        "flex h-10 w-full cursor-pointer items-center justify-between gap-2 rounded-(--m3-pill) bg-(--m3-control) px-4 text-sm text-(--md-on-surface) outline-none hover:bg-(--m3-control-hover) data-[placeholder]:text-(--md-on-surface-variant) aria-expanded:rounded-(--md-shape-md) aria-expanded:bg-(--m3-on) aria-expanded:text-(--m3-on-on) disabled:cursor-not-allowed disabled:bg-(--md-on-surface)/10 disabled:text-(--md-on-surface)/38 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon className="size-4 opacity-70" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      data-slot="select-scroll-up-button"
      className={cn(
        "flex cursor-default items-center justify-center py-1",
        className
      )}
      {...props}
    >
      <ChevronUpIcon className="size-4" />
    </SelectPrimitive.ScrollUpButton>
  );
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      data-slot="select-scroll-down-button"
      className={cn(
        "flex cursor-default items-center justify-center py-1",
        className
      )}
      {...props}
    >
      <ChevronDownIcon className="size-4" />
    </SelectPrimitive.ScrollDownButton>
  );
}

function SelectContent({
  className,
  children,
  position = "popper",
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        className={cn(
          // A floating surface (app/m3/controls.css `.m3-float`): tone and
          // elevation instead of a stroke, 28px corners, a spring entrance
          // that grows from the trigger.
          "m3-float relative z-50 max-h-96 min-w-[10rem] origin-(--radix-select-content-transform-origin) overflow-hidden rounded-(--md-shape-xl)",
          position === "popper" &&
            "data-[side=bottom]:translate-y-1.5 data-[side=left]:-translate-x-1.5 data-[side=right]:translate-x-1.5 data-[side=top]:-translate-y-1.5",
          className
        )}
        position={position}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          className={cn(
            "p-2",
            position === "popper" &&
              "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]"
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      className={cn("px-4 pt-2 pb-1 text-xs font-medium text-(--md-on-surface-variant)", className)}
      {...props}
    />
  );
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        // Rows are pills: 40px, 2px apart (app/m3/controls.css), a state layer
        // under the pointer, and the chosen one a full pill on tertiary-container.
        "relative flex min-h-10 w-full cursor-pointer select-none items-center justify-between gap-3 rounded-full px-4 py-2 text-sm outline-none data-[highlighted]:bg-(--m3-hover) data-[state=checked]:bg-(--m3-row-on) data-[state=checked]:font-medium data-[state=checked]:text-(--m3-on-row-on) data-[state=checked]:data-[highlighted]:bg-(--m3-row-on-hover) data-[disabled]:pointer-events-none data-[disabled]:opacity-40",
        className
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <span className="flex size-4 shrink-0 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="size-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
    </SelectPrimitive.Item>
  );
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      // M3 Expressive sets groups apart with a gap, not a rule.
      className={cn("h-2", className)}
      {...props}
    />
  );
}

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
};
