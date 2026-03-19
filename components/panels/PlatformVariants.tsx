interface PlatformVariantsProps {
  platforms: string[];
  active?: string;
  onChange?: (platform: string) => void;
}

export function PlatformVariants({
  platforms,
  active,
  onChange,
}: PlatformVariantsProps) {
  return (
    <div className="flex gap-1">
      {platforms.map((platform) => (
        <button
          key={platform}
          className={`rounded px-2 py-1 text-xs border ${
            platform === active ? "bg-foreground text-background" : "bg-background"
          }`}
          onClick={() => onChange?.(platform)}
        >
          {platform}
        </button>
      ))}
    </div>
  );
}
