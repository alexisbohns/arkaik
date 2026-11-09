# User Interface Knowledge

This document is a collection of knowledge about the user interface of the Arkaik product. It is intended to be a reference for developers and designers working on the product, as well as for users who want to understand how the interface works.

## Page surfaces

The layout every project surface shares: **no padding on the surface itself**, a toolbar flush against its top edge, and the content below.

The padding placement is the whole point. A padded surface pushes the bar off the edge it is pinned to, and rows then ride up through the gap as they scroll past; giving the padding to the content puts the edge exactly where the clipping happens.

## Segments, not rules

With a toolbar, a surface is drawn in segments (Material 3): each bar and the content are their own `bg-card` pieces, 4px of page background apart, 14px on the corners where the group meets the outside and 4px where two pieces meet. A node panel is drawn the same way — its header and its body are two segments. Nothing draws a hairline between them any more.

Two things make the gap real. The cell behind the surface would paint over it, so `PageSurface` marks a segmented surface with `data-surface-segments` and `PanelStack` drops the cell's fill when it sees one (`has-[>[data-surface-segments]]`). And in the scrolling mode the pinned toolbar stack paints the page background under its bars and across the gap below them, so content scrolling up disappears at the gap instead of showing through it.

## Two modes, one edge

Scrolling-column (default) — the surface is the scrollport, the toolbar is `sticky` inside it, and the content carries the padding. Filling-pane (`fill`) — the surface does not scroll at all, the toolbar is simply the first flex row, and the content takes the rest and scrolls itself. The toolbar looks and sits identically either way; only what happens below it differs.

## Why the box is `flex-1`, not `h-full`

`h-full` resolves against the panel cell, and the cell is a grid item that auto-sizes to its content — so a tall list grew the cell, the scroller matched the grown cell, and nothing ever scrolled. (`PanelStack` now pins the row to the viewport height, which is the other half of that fix.) `min-h-0 flex-1` asks for "whatever is left" instead of a percentage of something that moves, and cannot regress the same way.

Overflow is `y`-only in the scrolling mode: a toolbar that scrolls sideways out of its own surface is unusable, and every bar here wraps rather than growing wider.