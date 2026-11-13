"use client";

import { LayoutGridIcon, ListIcon, SparklesIcon, TextIcon } from "lucide-react";

import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  useDisplayPreferences,
  type AcceptanceDisplay,
} from "@/lib/hooks/useDisplayPreferences";
import { setPanelPreferences, usePanelPreferences, type PanelLook } from "@/lib/hooks/usePanelPreferences";

const ACCEPTANCE_DISPLAY_OPTIONS = [
  { id: "rows", label: "Rows", icon: ListIcon },
  { id: "cards", label: "Cards", icon: LayoutGridIcon },
] as const satisfies readonly { id: AcceptanceDisplay; label: string; icon: typeof ListIcon }[];

const PANEL_LOOK_OPTIONS = [
  { id: "expressive", label: "Expressive", icon: SparklesIcon },
  { id: "calm", label: "Calm", icon: TextIcon },
] as const satisfies readonly { id: PanelLook; label: string; icon: typeof ListIcon }[];

/**
 * How this reader wants the project drawn — the settings that change a display
 * without changing a fact.
 *
 * Kept apart from Products and Federation on the Settings page, and worded
 * apart too: everything else there edits the project, and a reader who changes
 * something here changes only what *they* see. The preferences live in this
 * browser (`useDisplayPreferences`), so there is nothing to save and nothing to
 * export — which is why this panel has no buttons and no dirty state.
 */
export function DisplayPreferencesPanel({ projectId }: { projectId: string }) {
  const [preferences, update] = useDisplayPreferences(projectId);
  const panels = usePanelPreferences();

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      {/* The one preference here that is the reader's rather than this
          project's: it lives under its own key and every project reads it,
          so the sentence says so instead of letting "these stay in this
          browser" imply it is per project. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium">Panels</p>
          <p className="text-sm text-muted-foreground">
            Expressive gives each record a hero title, its status as a lifecycle track and
            its species as a seal. Calm keeps to text: a quiet header line, a status chip,
            a Gherkin that reads as steps. Applies to every project in this browser.
          </p>
        </div>
        <SegmentedControl
          className="shrink-0 self-start"
          ariaLabel="Panel look"
          options={PANEL_LOOK_OPTIONS}
          value={panels.look}
          onChange={(look) => setPanelPreferences({ look })}
        />
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium">Acceptances in a panel</p>
          <p className="text-sm text-muted-foreground">
            Rows fit the whole list on screen and fold each acceptance&rsquo;s platforms into
            one strip of status-coloured icons. Cards give every platform its own labelled
            line.
          </p>
        </div>
        <SegmentedControl
          className="shrink-0 self-start"
          ariaLabel="Acceptance display"
          options={ACCEPTANCE_DISPLAY_OPTIONS}
          value={preferences.acceptanceDisplay}
          onChange={(next) => update({ acceptanceDisplay: next })}
        />
      </div>
    </div>
  );
}
