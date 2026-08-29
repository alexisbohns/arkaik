import {
  AccessibilityIcon,
  ActivityIcon,
  BlocksIcon,
  BotIcon,
  CircleDotIcon,
  EyeOffIcon,
  FlaskConicalIcon,
  GaugeIcon,
  HeartHandshakeIcon,
  ScaleIcon,
  ShieldIcon,
  StoreIcon,
  type LucideIcon,
} from "lucide-react";

/**
 * A glyph per Kritik domain.
 *
 * A map here rather than a field on `KritikDomain`, and the reason is where the
 * knowledge lives: a pack declares what a domain *is* — its code, its name, the
 * criteria under it — and which React component draws it is a decision about
 * this app's iconography, which no pack author should have to make and no
 * bundle should have to carry. The pack stays portable; the app stays free to
 * restyle.
 *
 * Keyed on the codes `packages/kritik-library/framework.json` ships. A
 * project's overlay is free to declare domains of its own (`quality.library
 * .domains`), and those land on the fallback rather than on nothing: a section
 * with no heading mark reads as a section that failed to render.
 */
const DOMAIN_ICONS: Record<string, LucideIcon> = {
  SEC: ShieldIcon,
  PRV: EyeOffIcon,
  GDP: ScaleIcon,
  SAF: HeartHandshakeIcon,
  ARC: BlocksIcon,
  TST: FlaskConicalIcon,
  PLT: StoreIcon,
  A11Y: AccessibilityIcon,
  PRF: GaugeIcon,
  REL: ActivityIcon,
  AGT: BotIcon,
};

/** The domain's mark, or the neutral one for a code this app does not know. */
export function domainIcon(code: string): LucideIcon {
  return DOMAIN_ICONS[code] ?? CircleDotIcon;
}

/** The codes with a mark of their own — the shape the icon test asserts over. */
export const KNOWN_DOMAIN_CODES = Object.keys(DOMAIN_ICONS);
