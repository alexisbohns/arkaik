"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BookOpenIcon,
  ClipboardCheckIcon,
  CornerDownLeftIcon,
  DatabaseIcon,
  FileTextIcon,
  FolderOpenIcon,
  GitBranchIcon,
  HistoryIcon,
  KeyRoundIcon,
  LayoutDashboardIcon,
  MapIcon,
  MapPinnedIcon,
  MonitorIcon,
  NetworkIcon,
  PyramidIcon,
  RouteIcon,
  SearchIcon,
  ServerIcon,
  Settings2Icon,
  Share2Icon,
  SquareKanbanIcon,
  SunMoonIcon,
  type LucideIcon,
} from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useModKeyLabel } from "@/lib/hooks/useModKeyLabel";
import {
  COMMAND_GROUPS,
  completionSuffix,
  rankCommands,
  type CommandActionId,
  type CommandGroupId,
  type CommandIconId,
  type CommandMatch,
  type PaletteCommand,
} from "@/lib/utils/command-palette";
import { cn } from "@/lib/utils";

/** Closed record: a new `CommandIconId` cannot ship without its glyph. */
const COMMAND_ICONS: Record<CommandIconId, LucideIcon> = {
  overview: LayoutDashboardIcon,
  "all-maps": MapIcon,
  journey: RouteIcon,
  system: NetworkIcon,
  "custom-map": MapPinnedIcon,
  library: BookOpenIcon,
  acceptances: ClipboardCheckIcon,
  views: MonitorIcon,
  flows: GitBranchIcon,
  "data-models": DatabaseIcon,
  "api-endpoints": ServerIcon,
  pyramid: PyramidIcon,
  delivery: SquareKanbanIcon,
  changelog: HistoryIcon,
  settings: Settings2Icon,
  docs: FileTextIcon,
  publish: Share2Icon,
  theme: SunMoonIcon,
  projects: FolderOpenIcon,
  tokens: KeyRoundIcon,
};

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commands: readonly PaletteCommand[];
  /** Runs the non-navigating commands — the palette itself only knows their id. */
  onAction: (action: CommandActionId) => void;
}

interface PaletteSection {
  id: CommandGroupId;
  label: string;
  items: CommandMatch[];
}

/** Split a label into plain and matched segments, so a hit reads as one
 * emphasised run rather than per-character confetti. */
function segmentLabel(label: string, highlight: readonly number[]) {
  if (highlight.length === 0) return [{ text: label, matched: false }];

  const matched = new Set(highlight);
  const segments: { text: string; matched: boolean }[] = [];
  for (let index = 0; index < label.length; index += 1) {
    const isMatched = matched.has(index);
    const previous = segments[segments.length - 1];
    if (previous && previous.matched === isMatched) {
      previous.text += label[index];
    } else {
      segments.push({ text: label[index], matched: isMatched });
    }
  }
  return segments;
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border bg-muted px-1.5 font-sans text-[10px] font-medium text-muted-foreground">
      {children}
    </kbd>
  );
}

/**
 * The ⌘K overlay: one input, ranked results grouped like the sidebar, inline
 * ghost completion, and a keyboard contract that never needs the mouse —
 * Enter validates the first suggestion, Tab fills it in, arrows move.
 */
export function CommandPalette({ open, onOpenChange, commands, onAction }: CommandPaletteProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[15%] translate-y-0 gap-0 overflow-hidden p-0 shadow-2xl sm:max-w-[600px] [&>button]:hidden">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">
          Search every page and action of this project, then press Enter to go there.
        </DialogDescription>
        {/* Radix unmounts the content on close, so the query and the selection
            reset by construction — no effect resetting state on open. */}
        <PaletteBody commands={commands} onAction={onAction} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

interface PaletteBodyProps {
  commands: readonly PaletteCommand[];
  onAction: (action: CommandActionId) => void;
  onClose: () => void;
}

function PaletteBody({ commands, onAction, onClose }: PaletteBodyProps) {
  const router = useRouter();
  const modKey = useModKeyLabel();
  const listId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const matches = useMemo(() => rankCommands(commands, query), [commands, query]);

  // Groups are laid out by their best result, so the top-ranked command is
  // always the first row of the first section — what Enter is about to run.
  const sections = useMemo<PaletteSection[]>(() => {
    const buckets = new Map<CommandGroupId, CommandMatch[]>();
    matches.forEach((match) => {
      const bucket = buckets.get(match.command.group);
      if (bucket) bucket.push(match);
      else buckets.set(match.command.group, [match]);
    });

    const bestRank = new Map<CommandGroupId, number>();
    matches.forEach((match, rank) => {
      if (!bestRank.has(match.command.group)) bestRank.set(match.command.group, rank);
    });

    return COMMAND_GROUPS.filter((group) => buckets.has(group.id))
      .map((group) => ({ id: group.id, label: group.label, items: buckets.get(group.id) ?? [] }))
      .sort((left, right) => (bestRank.get(left.id) ?? 0) - (bestRank.get(right.id) ?? 0));
  }, [matches]);

  /** Reading order — what the arrow keys walk, sections included. */
  const ordered = useMemo(() => sections.flatMap((section) => section.items), [sections]);
  const indexByCommandId = useMemo(
    () => new Map(ordered.map((match, index) => [match.command.id, index])),
    [ordered],
  );
  const active = ordered[activeIndex];
  const suffix = completionSuffix(query, active);

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, sections]);

  const runCommand = useCallback(
    (match: CommandMatch) => {
      onClose();
      const { target } = match.command;
      if (target.kind === "action") {
        onAction(target.action);
        return;
      }
      if (target.external) {
        window.open(target.href, "_blank", "noopener,noreferrer");
        return;
      }
      router.push(target.href);
    },
    [onAction, onClose, router],
  );

  /** Every edit re-ranks, so the highlight returns to the top suggestion:
   * Enter always validates the best answer to what is currently typed. */
  function updateQuery(next: string) {
    setQuery(next);
    setActiveIndex(0);
  }

  function moveActive(delta: number) {
    if (ordered.length === 0) return;
    setActiveIndex((current) => (current + delta + ordered.length) % ordered.length);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        moveActive(1);
        return;
      case "ArrowUp":
        event.preventDefault();
        moveActive(-1);
        return;
      case "Home":
        event.preventDefault();
        setActiveIndex(0);
        return;
      case "End":
        event.preventDefault();
        setActiveIndex(Math.max(ordered.length - 1, 0));
        return;
      case "Tab":
        event.preventDefault();
        // Complete what is being typed; with nothing left to add, Tab keeps its
        // familiar "next candidate" meaning instead of doing nothing.
        if (suffix && active?.completion) updateQuery(active.completion);
        else moveActive(event.shiftKey ? -1 : 1);
        return;
      case "ArrowRight":
        // Only at the caret's end, so it never steals plain cursor movement.
        if (
          suffix &&
          active?.completion &&
          event.currentTarget.selectionStart === query.length &&
          event.currentTarget.selectionEnd === query.length
        ) {
          event.preventDefault();
          updateQuery(active.completion);
        }
        return;
      case "Enter":
        if (!active) return;
        event.preventDefault();
        runCommand(active);
        return;
      case "Escape":
        // Claimed here so the map's own Escape handling (which would clear the
        // selection behind the overlay) sees a handled event.
        event.preventDefault();
        onClose();
        return;
      default:
    }
  }

  return (
    <>
      <div className="flex items-center gap-3 border-b px-4">
        <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
        <div className="relative flex-1">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 flex items-center overflow-hidden whitespace-pre text-sm"
          >
            <span className="invisible">{query}</span>
            <span className="text-muted-foreground/50">{suffix}</span>
          </div>
          <input
            autoFocus
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-autocomplete="both"
            aria-activedescendant={active ? `${listId}-${activeIndex}` : undefined}
            className="relative w-full bg-transparent py-3.5 text-sm outline-none placeholder:text-muted-foreground"
            placeholder="Jump to a map, a library, a setting…"
            value={query}
            onChange={(event) => updateQuery(event.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
        <Kbd>esc</Kbd>
      </div>

      <div
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label="Commands"
        className="max-h-[min(60vh,24rem)] overflow-y-auto overflow-x-hidden p-2"
      >
        {ordered.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">
            Nothing matches <span className="text-foreground">{query.trim()}</span>.
          </p>
        ) : (
          sections.map((section) => (
            <div key={section.id} className="pb-1 last:pb-0">
              <div className="px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {section.label}
              </div>
              {section.items.map((match) => {
                const index = indexByCommandId.get(match.command.id) ?? 0;
                const isActive = index === activeIndex;
                const Icon = COMMAND_ICONS[match.command.icon];

                return (
                  <div
                    key={match.command.id}
                    id={`${listId}-${index}`}
                    role="option"
                    aria-selected={isActive}
                    data-active={isActive}
                    onPointerMove={() => setActiveIndex(index)}
                    onClick={() => runCommand(match)}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm",
                      isActive ? "bg-accent text-accent-foreground" : "text-foreground",
                    )}
                  >
                    <Icon className={cn("size-4 shrink-0", isActive ? "" : "text-muted-foreground")} />
                    <span className="truncate">
                      {segmentLabel(match.command.label, match.highlight).map((segment, segmentIndex) => (
                        <span
                          key={segmentIndex}
                          className={segment.matched ? "font-semibold underline decoration-dotted underline-offset-2" : ""}
                        >
                          {segment.text}
                        </span>
                      ))}
                    </span>
                    <span className="ml-auto flex shrink-0 items-center gap-2 pl-4">
                      {match.command.hint ? (
                        <span className="hidden truncate text-xs text-muted-foreground sm:block">
                          {match.command.hint}
                        </span>
                      ) : null}
                      {/* Kept in the layout when idle, so the row does not
                          twitch as the selection moves. */}
                      <CornerDownLeftIcon
                        className={cn("size-3.5 text-muted-foreground", isActive ? "" : "invisible")}
                      />
                    </span>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>

      <div className="flex items-center gap-4 border-t bg-muted/40 px-4 py-2 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Kbd>↵</Kbd> open
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>tab</Kbd> complete
        </span>
        <span className="hidden items-center gap-1.5 sm:flex">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> browse
        </span>
        {modKey ? (
          <span className="ml-auto flex items-center gap-1.5">
            <Kbd>{modKey}</Kbd>
            <Kbd>K</Kbd>
          </span>
        ) : null}
      </div>
    </>
  );
}
