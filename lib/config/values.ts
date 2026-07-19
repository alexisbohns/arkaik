import { VALUE_IDS, VALUE_TIERS, type ValueId, type ValueTierId } from "@arkaik/schema";

/** UI mirror for the value tiers (spec §3.2) — label + tier color. */
export const VALUE_TIERS_CONFIG = [
  { id: "functional",    label: "Functional",    color: "#94a3b8" },
  { id: "emotional",     label: "Emotional",     color: "#fb7185" },
  { id: "life-changing", label: "Life-changing", color: "#a78bfa" },
  { id: "social-impact", label: "Social impact", color: "#10b981" },
] as const satisfies readonly { id: ValueTierId; label: string; color: string }[];

/** Label per value element — a missing/typo'd id is a compile error. */
const VALUE_LABELS: Record<ValueId, string> = {
  // functional
  "saves-time": "Saves time",
  simplifies: "Simplifies",
  "makes-money": "Makes money",
  "reduces-risk": "Reduces risk",
  organizes: "Organizes",
  integrates: "Integrates",
  connects: "Connects",
  "reduces-effort": "Reduces effort",
  "avoids-hassles": "Avoids hassles",
  "reduces-cost": "Reduces cost",
  quality: "Quality",
  variety: "Variety",
  "sensory-appeal": "Sensory appeal",
  informs: "Informs",
  // emotional
  "reduces-anxiety": "Reduces anxiety",
  "rewards-me": "Rewards me",
  nostalgia: "Nostalgia",
  "design-aesthetics": "Design / aesthetics",
  "badge-value": "Badge value",
  wellness: "Wellness",
  "therapeutic-value": "Therapeutic value",
  "fun-entertainment": "Fun / entertainment",
  attractiveness: "Attractiveness",
  "provides-access": "Provides access",
  // life-changing
  "provides-hope": "Provides hope",
  "self-actualization": "Self-actualization",
  motivation: "Motivation",
  heirloom: "Heirloom",
  "affiliation-belonging": "Affiliation & belonging",
  // social-impact
  "self-transcendence": "Self-transcendence",
};

/**
 * Lucide icon name per element (spec §9.2: every element renders icon + label
 * everywhere). A missing/typo'd id is a compile error.
 */
const VALUE_ICONS: Record<ValueId, string> = {
  // functional
  "saves-time": "Timer",
  simplifies: "Wand2",
  "makes-money": "Banknote",
  "reduces-risk": "ShieldCheck",
  organizes: "FolderKanban",
  integrates: "Blocks",
  connects: "Link2",
  "reduces-effort": "Feather",
  "avoids-hassles": "Umbrella",
  "reduces-cost": "PiggyBank",
  quality: "Gem",
  variety: "Shapes",
  "sensory-appeal": "Sparkles",
  informs: "Info",
  // emotional
  "reduces-anxiety": "Leaf",
  "rewards-me": "Gift",
  nostalgia: "Hourglass",
  "design-aesthetics": "Palette",
  "badge-value": "BadgeCheck",
  wellness: "HeartPulse",
  "therapeutic-value": "Stethoscope",
  "fun-entertainment": "PartyPopper",
  attractiveness: "Star",
  "provides-access": "KeyRound",
  // life-changing
  "provides-hope": "Sunrise",
  "self-actualization": "Mountain",
  motivation: "Flame",
  heirloom: "Landmark",
  "affiliation-belonging": "Users",
  // social-impact
  "self-transcendence": "Globe",
};

/**
 * UI mirror for the 30 Bain B2C value elements. `tier` derives from the
 * schema's VALUE_TIERS so it can never drift; the Record types above make a
 * missing element a compile error.
 */
export const VALUES = VALUE_IDS.map((id) => ({
  id,
  tier: VALUE_TIERS[id],
  label: VALUE_LABELS[id],
  icon: VALUE_ICONS[id],
}));

export type { ValueId, ValueTierId };
