"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useModKeyLabel } from "@/lib/hooks/useModKeyLabel";
import {
  formatShortcutKey,
  getShortcutGroups,
  type ShortcutEntry,
} from "@/lib/utils/keyboard-shortcuts";

interface KeyboardShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Project chords are dead keys in the docs shell, so they are hidden there. */
  inProject?: boolean;
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border bg-muted px-1.5 font-sans text-[10px] font-medium text-muted-foreground">
      {children}
    </kbd>
  );
}

function Chord({ keys, modLabel }: { keys: readonly string[]; modLabel: string | null }) {
  return (
    <span className="inline-flex items-center gap-1">
      {keys.map((key) => (
        <Kbd key={key}>{formatShortcutKey(key, modLabel)}</Kbd>
      ))}
    </span>
  );
}

function ShortcutRow({ shortcut, modLabel }: { shortcut: ShortcutEntry; modLabel: string | null }) {
  return (
    <div className="flex items-center justify-between gap-6 py-1.5">
      <span className="text-sm text-foreground">{shortcut.description}</span>
      <span className="flex shrink-0 items-center gap-1.5">
        <Chord keys={shortcut.keys} modLabel={modLabel} />
        {shortcut.altKeys ? (
          <>
            <span className="text-[10px] text-muted-foreground">or</span>
            <Chord keys={shortcut.altKeys} modLabel={modLabel} />
          </>
        ) : null}
      </span>
    </div>
  );
}

/**
 * The ⌘? cheat sheet — every chord the app answers to, grouped by where it
 * fires. It reads `lib/utils/keyboard-shortcuts.ts` rather than restating the
 * handlers, so a shortcut and its documentation cannot drift apart.
 */
export function KeyboardShortcutsDialog({
  open,
  onOpenChange,
  inProject = false,
}: KeyboardShortcutsDialogProps) {
  const modKey = useModKeyLabel();
  const groups = getShortcutGroups(inProject);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Press <Kbd>{formatShortcutKey("Mod", modKey)}</Kbd> <Kbd>?</Kbd> anywhere to bring this
            back.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5">
          {groups.map((group) => (
            <section key={group.id} className="flex flex-col gap-0.5">
              <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {group.label}
              </h3>
              <div className="divide-y">
                {group.shortcuts.map((shortcut) => (
                  <ShortcutRow key={shortcut.id} shortcut={shortcut} modLabel={modKey} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
