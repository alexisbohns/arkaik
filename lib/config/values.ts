import type { ValueId, ValueTierId } from "@arkaik/schema";

/** UI mirror for the value tiers (spec §3.2) — label + tier color. */
export const VALUE_TIERS_CONFIG = [
  { id: "functional",    label: "Functional",    color: "#94a3b8" },
  { id: "emotional",     label: "Emotional",     color: "#fb7185" },
  { id: "life-changing", label: "Life-changing", color: "#a78bfa" },
  { id: "social-impact", label: "Social impact", color: "#10b981" },
] as const satisfies readonly { id: ValueTierId; label: string; color: string }[];

/**
 * UI mirror for the 30 Bain B2C value elements — label + lucide icon name per
 * element (spec §9.2: every element renders icon + label everywhere).
 */
export const VALUES = [
  // functional
  { id: "saves-time",       tier: "functional", label: "Saves time",       icon: "Timer" },
  { id: "simplifies",       tier: "functional", label: "Simplifies",       icon: "Wand2" },
  { id: "makes-money",      tier: "functional", label: "Makes money",      icon: "Banknote" },
  { id: "reduces-risk",     tier: "functional", label: "Reduces risk",     icon: "ShieldCheck" },
  { id: "organizes",        tier: "functional", label: "Organizes",        icon: "FolderKanban" },
  { id: "integrates",       tier: "functional", label: "Integrates",       icon: "Blocks" },
  { id: "connects",         tier: "functional", label: "Connects",         icon: "Link2" },
  { id: "reduces-effort",   tier: "functional", label: "Reduces effort",   icon: "Feather" },
  { id: "avoids-hassles",   tier: "functional", label: "Avoids hassles",   icon: "Umbrella" },
  { id: "reduces-cost",     tier: "functional", label: "Reduces cost",     icon: "PiggyBank" },
  { id: "quality",          tier: "functional", label: "Quality",          icon: "Gem" },
  { id: "variety",          tier: "functional", label: "Variety",          icon: "Shapes" },
  { id: "sensory-appeal",   tier: "functional", label: "Sensory appeal",   icon: "Sparkles" },
  { id: "informs",          tier: "functional", label: "Informs",          icon: "Info" },
  // emotional
  { id: "reduces-anxiety",   tier: "emotional", label: "Reduces anxiety",   icon: "Leaf" },
  { id: "rewards-me",        tier: "emotional", label: "Rewards me",        icon: "Gift" },
  { id: "nostalgia",         tier: "emotional", label: "Nostalgia",         icon: "Hourglass" },
  { id: "design-aesthetics", tier: "emotional", label: "Design / aesthetics", icon: "Palette" },
  { id: "badge-value",       tier: "emotional", label: "Badge value",       icon: "BadgeCheck" },
  { id: "wellness",          tier: "emotional", label: "Wellness",          icon: "HeartPulse" },
  { id: "therapeutic-value", tier: "emotional", label: "Therapeutic value", icon: "Stethoscope" },
  { id: "fun-entertainment", tier: "emotional", label: "Fun / entertainment", icon: "PartyPopper" },
  { id: "attractiveness",    tier: "emotional", label: "Attractiveness",    icon: "Star" },
  { id: "provides-access",   tier: "emotional", label: "Provides access",   icon: "KeyRound" },
  // life-changing
  { id: "provides-hope",        tier: "life-changing", label: "Provides hope",        icon: "Sunrise" },
  { id: "self-actualization",   tier: "life-changing", label: "Self-actualization",   icon: "Mountain" },
  { id: "motivation",           tier: "life-changing", label: "Motivation",           icon: "Flame" },
  { id: "heirloom",             tier: "life-changing", label: "Heirloom",             icon: "Landmark" },
  { id: "affiliation-belonging", tier: "life-changing", label: "Affiliation & belonging", icon: "Users" },
  // social-impact
  { id: "self-transcendence", tier: "social-impact", label: "Self-transcendence", icon: "Globe" },
] as const satisfies readonly { id: ValueId; tier: ValueTierId; label: string; icon: string }[];

export type { ValueId, ValueTierId };
