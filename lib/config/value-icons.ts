import { icons, type LucideIcon } from "lucide-react";
import type { ValueId } from "@arkaik/schema";
import { VALUES } from "@/lib/config/values";

/**
 * lucide component per value element, resolved from the icon-NAME strings in
 * lib/config/values.ts (the single source). Reading `icons[name]` means a
 * rename in values.ts flows here automatically — no second hand-maintained
 * list to drift (spec §9.2: every element renders icon + label).
 */
export const VALUE_ICON_COMPONENTS: Record<ValueId, LucideIcon> = Object.fromEntries(
  VALUES.map((v) => [v.id, icons[v.icon as keyof typeof icons]]),
) as Record<ValueId, LucideIcon>;
