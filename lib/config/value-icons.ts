import type { LucideIcon } from "lucide-react";
import {
  Timer, WandSparkles, Banknote, ShieldCheck, FolderKanban, Blocks, Link2,
  Feather, Umbrella, PiggyBank, Gem, Shapes, Sparkles, Info,
  Leaf, Gift, Hourglass, Palette, BadgeCheck, HeartPulse, Stethoscope,
  PartyPopper, Star, KeyRound,
  Sunrise, Mountain, Flame, Landmark, Users, Globe,
} from "lucide-react";
import type { ValueId } from "@arkaik/schema";

/**
 * lucide component per value element. Static named imports (tree-shakeable,
 * matching node-styles.ts) — a dynamic `icons[name]` lookup would ship the
 * entire lucide barrel to any client bundle importing ValueBadge. The
 * value-icons drift test asserts each component's displayName equals the
 * icon-name string in lib/config/values.ts (the single source), so this map
 * can't silently diverge from it (spec §9.2: every element renders icon +
 * label).
 */
export const VALUE_ICON_COMPONENTS: Record<ValueId, LucideIcon> = {
  // functional
  "saves-time": Timer,
  simplifies: WandSparkles,
  "makes-money": Banknote,
  "reduces-risk": ShieldCheck,
  organizes: FolderKanban,
  integrates: Blocks,
  connects: Link2,
  "reduces-effort": Feather,
  "avoids-hassles": Umbrella,
  "reduces-cost": PiggyBank,
  quality: Gem,
  variety: Shapes,
  "sensory-appeal": Sparkles,
  informs: Info,
  // emotional
  "reduces-anxiety": Leaf,
  "rewards-me": Gift,
  nostalgia: Hourglass,
  "design-aesthetics": Palette,
  "badge-value": BadgeCheck,
  wellness: HeartPulse,
  "therapeutic-value": Stethoscope,
  "fun-entertainment": PartyPopper,
  attractiveness: Star,
  "provides-access": KeyRound,
  // life-changing
  "provides-hope": Sunrise,
  "self-actualization": Mountain,
  motivation: Flame,
  heirloom: Landmark,
  "affiliation-belonging": Users,
  // social-impact
  "self-transcendence": Globe,
};
