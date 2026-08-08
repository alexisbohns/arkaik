import * as React from "react";

import { cn } from "@/lib/utils";

interface TableProps extends React.ComponentProps<"table"> {
  /**
   * Classes for the scroll container around the table, not the table itself.
   *
   * Pass `"h-full overflow-auto"` to make the table own a scrollport of its own
   * — the filling-pane case, where the table is the whole surface and its header
   * is `sticky`. Left alone, the table is a block in a scrolling column and the
   * column scrolls it.
   */
  containerClassName?: string;
}

function Table({ className, containerClassName, ...props }: TableProps) {
  return (
    <div
      data-slot="table-container"
      // `overflow-y-hidden` is not decoration — it is the fix for a wheel trap,
      // and it takes two rules to explain.
      //
      // First: `overflow-x-auto` alone leaves `overflow-y` at `visible`, and CSS
      // *computes that to `auto`*, because `visible` cannot pair with a
      // non-visible value on the other axis. So this div was silently a vertical
      // scrollport too — one whose height is `auto`, i.e. one with nothing to
      // scroll. Harmless on its own, because a wheel over an exhausted scroller
      // chains to its ancestor.
      //
      // Second: `globals.css` gives every scroll container — this one by
      // `data-slot` — `overscroll-behavior: contain`, which exists to stop swipes
      // becoming browser navigation. Containment also blocks that chaining. The
      // two together meant a wheel anywhere over a table stopped dead, and the
      // surface only scrolled from the strip of padding beside it.
      //
      // Naming the axis keeps the horizontal scroll wide tables need, and leaves
      // no vertical scrollport for containment to hold on to.
      className={cn("relative w-full overflow-x-auto overflow-y-hidden", containerClassName)}
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b", className)}
      {...props}
    />
  );
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  );
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "bg-muted/50 border-t font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  );
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "hover:bg-muted/50 data-[state=selected]:bg-muted border-b transition-colors",
        className
      )}
      {...props}
    />
  );
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "text-foreground h-10 px-2 text-left align-middle font-medium whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className
      )}
      {...props}
    />
  );
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("text-muted-foreground mt-4 text-sm", className)}
      {...props}
    />
  );
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
};
