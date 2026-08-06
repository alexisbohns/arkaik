import type { LucideIcon } from "lucide-react";

import { SelectItem } from "@/components/ui/select";
import { STATUSES, type StatusId } from "@/lib/config/statuses";
import { DECISION_STATUSES, type DecisionStatusId } from "@/lib/config/decision-statuses";
import {
  DECISION_STATUS_ICONS,
  DECISION_STATUS_STYLES,
  STATUS_ICONS,
  STATUS_STYLES,
} from "@/components/graph/nodes/node-styles";

/**
 * The status menu's options — icon in the status colour, then the label — copied
 * character-for-character into five components, with a sixth repeating the shape
 * for decision statuses and a seventh rendering it without icons (audit
 * `factorization-1`).
 *
 * **It lives in `components/layout/`, not beside `node-styles.ts`**, for two
 * reasons. `node-styles.ts` is a pure data module — no JSX, no `"use client"` —
 * and every consumer of it benefits from that staying true. And its real
 * siblings are here: `StatusBadge` and `DecisionStatusBadge` render the same two
 * vocabularies with the same icon-plus-colour treatment, so the three files that
 * decide what a status *looks like* now sit together.
 *
 * Items only — the caller keeps its own `Select`, its trigger's `aria-label`,
 * and any leading entry the menu needs ("All statuses" in the filter bars, "No
 * status" in `PlatformVariants`), because those differ per surface and the
 * options do not.
 */

interface StatusVocabulary<Id extends string> {
  options: readonly { id: Id; label: string }[];
  icons: Record<Id, LucideIcon>;
  styles: Record<Id, { badge: string }>;
}

const STATUS_VOCABULARY: StatusVocabulary<StatusId> = {
  options: STATUSES,
  icons: STATUS_ICONS,
  styles: STATUS_STYLES,
};

const DECISION_STATUS_VOCABULARY: StatusVocabulary<DecisionStatusId> = {
  options: DECISION_STATUSES,
  icons: DECISION_STATUS_ICONS,
  styles: DECISION_STATUS_STYLES,
};

export type StatusVocabularyId = "status" | "decision-status";

interface StatusSelectItemsProps {
  /** Lifecycle statuses (default) or the decision-record vocabulary. */
  vocabulary?: StatusVocabularyId;
  /**
   * Off for menus that are a plain list of names — the prompt builder's
   * "default status for new nodes", which picks a value for nodes that do not
   * exist yet and so has no state to colour.
   */
  showIcons?: boolean;
}

function renderItems<Id extends string>(vocabulary: StatusVocabulary<Id>, showIcons: boolean) {
  return (
    <>
      {vocabulary.options.map((option) => {
        if (!showIcons) {
          return (
            <SelectItem key={option.id} value={option.id}>
              {option.label}
            </SelectItem>
          );
        }

        // Annotated because `Record<Id, LucideIcon>[Id]` stays an unresolved
        // indexed-access type while `Id` is generic, and JSX will not call it.
        const Icon: LucideIcon = vocabulary.icons[option.id];

        return (
          <SelectItem key={option.id} value={option.id}>
            <span className="inline-flex items-center gap-2">
              <Icon className={`size-3.5 ${vocabulary.styles[option.id].badge}`} />
              {option.label}
            </span>
          </SelectItem>
        );
      })}
    </>
  );
}

export function StatusSelectItems({
  vocabulary = "status",
  showIcons = true,
}: StatusSelectItemsProps) {
  return vocabulary === "decision-status"
    ? renderItems(DECISION_STATUS_VOCABULARY, showIcons)
    : renderItems(STATUS_VOCABULARY, showIcons);
}
