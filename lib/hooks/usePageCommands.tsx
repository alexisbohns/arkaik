"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import type { PaletteCommand } from "@/lib/utils/command-palette";

/** A page's own action — "New node", "New map" — offered in the ⌘K palette. */
export interface PageAction {
  label: string;
  /** Kept for callers; the palette draws every page action with the create glyph. */
  icon?: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
}

/**
 * What the page on screen does with a flow or view chosen in the palette —
 * the Screens map flies to it. A page that registers none gets the layout's
 * default: the node's panel, or the Library where no panel can open.
 */
export type PageNodeHandler = (nodeId: string) => void;

type Register = (command: PaletteCommand) => () => void;
type RegisterNodeHandler = (handler: PageNodeHandler) => () => void;

const PageCommandsContext = createContext<Register | null>(null);
const PageNodeHandlerContext = createContext<RegisterNodeHandler | null>(null);

/**
 * Holds the commands the current page contributes to the palette, beside the
 * project-wide catalogue the layout builds, and the page's node handler. A
 * page registers on mount and is gone on unmount, so the palette only ever
 * offers what the page on screen can actually do.
 */
export function PageCommandsProvider({
  children,
}: {
  children: (commands: PaletteCommand[], nodeHandler: PageNodeHandler | null) => ReactNode;
}) {
  const [commands, setCommands] = useState<PaletteCommand[]>([]);
  // Boxed: a bare function in state would be taken for an updater and called.
  const [nodeHandler, setNodeHandler] = useState<{ run: PageNodeHandler } | null>(null);

  const register = useCallback<Register>((command) => {
    setCommands((previous) => [...previous.filter((entry) => entry.id !== command.id), command]);
    return () => setCommands((previous) => previous.filter((entry) => entry !== command));
  }, []);

  const registerNodeHandler = useCallback<RegisterNodeHandler>((handler) => {
    const entry = { run: handler };
    setNodeHandler(entry);
    // Only the entry this call installed is removed: a page that registered
    // after it keeps its own.
    return () => setNodeHandler((current) => (current === entry ? null : current));
  }, []);

  return (
    <PageCommandsContext.Provider value={register}>
      <PageNodeHandlerContext.Provider value={registerNodeHandler}>
        {children(commands, nodeHandler?.run ?? null)}
      </PageNodeHandlerContext.Provider>
    </PageCommandsContext.Provider>
  );
}

/**
 * Offer a page's action in the palette's Create group for as long as the page
 * is mounted — the home the header's create button moved to.
 *
 * Registered on what the row *shows* (label, disabled), never on the action's
 * identity: callers pass an inline object whose `onClick` is a fresh closure
 * every render, and re-registering on each one would churn the palette's list.
 * The latest `onClick` is read through a ref at the moment the command runs.
 */
export function usePageAction(action: PageAction | undefined) {
  const register = useContext(PageCommandsContext);
  const latest = useRef(action);
  useEffect(() => {
    latest.current = action;
  });

  const label = action?.label;
  const disabled = action?.disabled ?? false;

  useEffect(() => {
    if (!register || !label || disabled) return;
    return register({
      id: `page-action:${label}`,
      label,
      group: "create",
      icon: "create",
      keywords: ["create", "new", "add"],
      hint: "On this page",
      target: { kind: "run", run: () => latest.current?.onClick() },
    });
  }, [register, label, disabled]);
}

/**
 * Handle the palette's flow and view rows on this page for as long as it is
 * mounted. Registered once, on whether a handler is given, never on its
 * identity — callers pass a closure over their render's state — and the latest
 * handler is read through a ref when a row runs, exactly as `usePageAction`
 * reads its `onClick`.
 */
export function usePageNodeHandler(handler: PageNodeHandler | undefined) {
  const register = useContext(PageNodeHandlerContext);
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });

  const enabled = handler !== undefined;

  useEffect(() => {
    if (!register || !enabled) return;
    return register((nodeId) => latest.current?.(nodeId));
  }, [register, enabled]);
}
