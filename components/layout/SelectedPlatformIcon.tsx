import { MonitorSmartphoneIcon } from "lucide-react";
import { PLATFORM_ICONS } from "@/components/graph/nodes/node-styles";
import type { PlatformId } from "@/lib/config/platforms";

/**
 * A platform filter's trigger glyph: the selected platform's own icon, or the
 * generic one while unfiltered — the one filter whose value is itself an icon,
 * so the trigger may as well say which. Shared by the Acceptances and Delivery
 * bars.
 */
export function SelectedPlatformIcon({ platform }: { platform: "all" | PlatformId }) {
  if (platform === "all") return <MonitorSmartphoneIcon />;
  const Icon = PLATFORM_ICONS[platform];
  return <Icon />;
}
