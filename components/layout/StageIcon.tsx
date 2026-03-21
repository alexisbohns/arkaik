import { cn } from "@/lib/utils";
import { STAGE_ICONS, STAGE_LABELS, STAGE_STYLES, type StageId } from "@/lib/config/stages";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface StageIconProps {
  stage?: string;
  className?: string;
}

export function StageIcon({ stage, className }: StageIconProps) {
  if (!stage) return null;
  const Icon = STAGE_ICONS[stage as StageId];
  if (!Icon) return null;
  const label = STAGE_LABELS[stage as StageId] ?? stage;
  const colorClass = STAGE_STYLES[stage as StageId] ?? "text-muted-foreground";

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn("inline-flex items-center", className)}>
            <Icon className={cn("w-4 h-4", colorClass)} aria-hidden="true" />
            <span className="sr-only">{label}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
