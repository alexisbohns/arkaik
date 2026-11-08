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

type Register = (command: PaletteCommand) => () => void;

const PageCommandsContext = createContext<Register | null>(null);

/**
 * Holds the commands the current page contributes to the palette, beside the
 * project-wide catalogue the layout builds. A page registers on mount and is
 * gone on unmount, so the palette only ever offers what the page on screen can
 * actually do.
 */
export function PageCommandsProvider({ children }: { children: (commands: PaletteCommand[]) => ReactNode }) {
  const [commands, setCommands] = useState<PaletteCommand[]>([]);

  const register = useCallback<Register>((command) => {
    setCommands((previous) => [...previous.filter((entry) => entry.id !== command.id), command]);
    return () => setCommands((previous) => previous.filter((entry) => entry !== command));
  }, []);

  return <PageCommandsContext.Provider value={register}>{children(commands)}</PageCommandsContext.Provider>;
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
