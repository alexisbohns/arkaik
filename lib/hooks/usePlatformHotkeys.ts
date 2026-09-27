"use client";

import type { PlatformId } from "@/lib/config/platforms";
import { GUARDED_HOTKEY, toolbarKey, useShortcuts } from "@/lib/hooks/useShortcut";
import { nextPlatformFilter } from "@/lib/utils/keyboard";
import { PLATFORM_HOTKEYS } from "@/lib/utils/keyboard-shortcuts";

interface PlatformHotkeysOptions {
  /** `showPlatformFilter` from `usePlatformFilterControl` — no control, no keys. */
  enabled: boolean;
  /** `platformOptions` from the same hook: a platform off-scope is a dead key. */
  available: readonly { id: PlatformId }[];
  current: "all" | PlatformId;
  onSelect: (next: "all" | PlatformId) => void;
}

/**
 * `i` / `w` / `a` over a bar's platform control. Gated with `enabled` rather
 * than a no-op callback: TanStack prevents the key before the callback runs,
 * so a key that cannot act must not be registered as live.
 */
export function usePlatformHotkeys({ enabled, available, current, onSelect }: PlatformHotkeysOptions): void {
  useShortcuts(
    (Object.entries(PLATFORM_HOTKEYS) as [PlatformId, string][]).map(([platform, id]) => ({
      id,
      callback: toolbarKey(() => onSelect(nextPlatformFilter(current, platform))),
      options: { ...GUARDED_HOTKEY, enabled: enabled && available.some((option) => option.id === platform) },
    })),
  );
}
