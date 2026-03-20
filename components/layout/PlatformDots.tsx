import type { PlatformId } from "@/lib/config/platforms";
import { PLATFORM_DOT_STYLES, PLATFORM_LABELS } from "@/components/graph/nodes/node-styles";

interface PlatformDotsProps {
  platforms: PlatformId[];
}

export function PlatformDots({ platforms }: PlatformDotsProps) {
  if (platforms.length === 0) return null;

  return (
    <div className="flex items-center gap-1">
      {platforms.map((platform) => (
        <span
          key={platform}
          title={PLATFORM_LABELS[platform]}
          className={`w-2 h-2 rounded-full ${PLATFORM_DOT_STYLES[platform]}`}
        />
      ))}
    </div>
  );
}
