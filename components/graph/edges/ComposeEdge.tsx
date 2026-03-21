import { EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from "@xyflow/react";
import { PlusIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { useToolbarHover } from "@/lib/hooks/useToolbarHover";

interface ComposeEdgeData extends Record<string, unknown> {
  insertLabel?: string;
  label?: string;
  onInsert?: () => void;
}

export function ComposeEdge({
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  data,
}: EdgeProps) {
  const { isHovered, nodeProps: pathProps, toolbarProps: buttonProps } = useToolbarHover();
  const [edgePath, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  const edgeData = data as ComposeEdgeData | undefined;

  return (
    <>
      <path
        d={edgePath}
        fill="none"
        strokeWidth={2}
        className="react-flow__edge-path"
        {...pathProps}
      />
      {/* Wide transparent hit area to make hover easier */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        {...pathProps}
      />

      {(edgeData?.label || (isHovered && edgeData?.onInsert)) && (
        <EdgeLabelRenderer>
          <>
            {edgeData?.label && (
              <div
                style={{
                  position: "absolute",
                  transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY - (edgeData.onInsert ? 16 : 0)}px)`,
                  pointerEvents: "none",
                }}
                className="rounded-full border bg-background/95 px-2 py-0.5 text-[11px] font-medium text-muted-foreground shadow-sm"
              >
                {edgeData.label}
              </div>
            )}
            {isHovered && edgeData?.onInsert && (
              <div
                style={{
                  position: "absolute",
                  transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY + (edgeData.label ? 14 : 0)}px)`,
                  pointerEvents: "all",
                }}
                {...buttonProps}
              >
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={edgeData.onInsert}
                        className="size-6 rounded-full"
                      >
                        <PlusIcon className="size-3" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">{edgeData.insertLabel}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            )}
          </>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
