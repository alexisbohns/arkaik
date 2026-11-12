import { ChevronLeftIcon, ChevronRightIcon, PauseIcon, PlayIcon, RotateCcwIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface TourControlsProps {
  step: number;
  steps: number;
  playing: boolean;
  /** The last step played to its end (or is shown complete): Play starts over. */
  atEnd: boolean;
  onBack: () => void;
  onToggle: () => void;
  onNext: () => void;
  className?: string;
}

/**
 * Back, Play/Pause, Next, and where the tour stands. Below 768px the bar is
 * fixed to the bottom of the screen with 44px targets; above, it sits in the
 * player. Back on the first step and Next on the last are `aria-disabled`, not
 * `disabled`: a disabled button drops its focus, and the next press of → would
 * then land nowhere.
 *
 * Autoplay always has this visible pause control (WCAG 2.2.2).
 */
export function TourControls({ step, steps, playing, atEnd, onBack, onToggle, onNext, className }: TourControlsProps) {
  const firstStep = step <= 1;
  const lastStep = step >= steps;
  const playLabel = playing ? "Pause the tour" : atEnd ? "Replay the tour" : "Play the tour";
  return (
    <div
      className={cn(
        "fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 px-4 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur",
        "md:static md:z-auto md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none",
        className,
      )}
    >
      <div className="mx-auto flex max-w-md items-center gap-2 md:mx-0 md:max-w-none">
        <Button
          type="button"
          variant="outline"
          onClick={onBack}
          aria-disabled={firstStep || undefined}
          className="h-11 flex-1 aria-disabled:cursor-default aria-disabled:opacity-50 md:h-9 md:flex-none"
        >
          <ChevronLeftIcon aria-hidden="true" />
          Back
        </Button>
        <Button
          type="button"
          onClick={onToggle}
          aria-label={playLabel}
          className="h-11 flex-[1.4] md:h-9 md:w-28 md:flex-none"
        >
          {playing ? (
            <PauseIcon aria-hidden="true" />
          ) : atEnd ? (
            <RotateCcwIcon aria-hidden="true" />
          ) : (
            <PlayIcon aria-hidden="true" />
          )}
          {playing ? "Pause" : atEnd ? "Replay" : "Play"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onNext}
          aria-disabled={lastStep || undefined}
          className="h-11 flex-1 aria-disabled:cursor-default aria-disabled:opacity-50 md:h-9 md:flex-none"
        >
          Next
          <ChevronRightIcon aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
