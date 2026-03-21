import { EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from "@xyflow/react";
import { PlusIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { useToolbarHover } from "@/lib/hooks/useToolbarHover";

interface ComposeEdgeData extends Record<string, unknown> {
  insertLabel?: string;
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
}: EdgeProps<ComposeEdgeData>) {
  const { isHovered, nodeProps: pathProps, toolbarProps: buttonProps } = useToolbarHover();
  const [edgePath, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });

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

      {isHovered && data?.onInsert && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
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
                    onClick={data.onInsert}
                    className="size-6 rounded-full"
                  >
                    <PlusIcon className="size-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">{data.insertLabel}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
