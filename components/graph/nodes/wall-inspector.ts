"use client";

import { createContext } from "react";

/**
 * The Screens map's quick inspector region's id: there is one map, so one
 * inspector, on a page. The selected frame names it in `aria-controls` and
 * `aria-describedby`, and Tab from that frame moves into it.
 */
export const SCREEN_INSPECTOR_ID = "screens-inspector";

/**
 * The inspector region's id while it can show — no panel open, so a selection
 * puts it on screen — else null (the inspector stands aside for a panel, and
 * a frame must not point at an element that is not there). Provided by the
 * controller; a frame reads it only to wire itself to the region when it is
 * the selected one. Its value changes on a panel opening or closing, never on
 * a selection, so selecting re-renders no other frame.
 */
export const WallInspectorContext = createContext<string | null>(null);

/** What Tab can reach inside the inspector, in DOM order. */
export const INSPECTOR_FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
