interface PlatformDotsProps {
  platforms: string[];
}

export function PlatformDots({ platforms }: PlatformDotsProps) {
  return (
    <div className="flex gap-1">
      {platforms.map((platform) => (
        <span
          key={platform}
          title={platform}
          className="h-2 w-2 rounded-full bg-foreground/40"
        />
      ))}
    </div>
  );
}
