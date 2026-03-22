import { EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from "@xyflow/react";
import { PlusIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { useToolbarHover } from "@/lib/hooks/useToolbarHover";

interface ComposeEdgeData extends Record<string, unknown> {
  insertActions?: Array<{
    label: string;
    onInsert: () => void;
  }>;
  insertLabel?: string;
  label?: string;
  onInsert?: () => void;
  edgeColor?: "green" | "yellow";
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
  const edgeColor = edgeData?.edgeColor;
  const insertActions = edgeData?.insertActions
    ?? (edgeData?.onInsert
      ? [{ label: edgeData.insertLabel ?? "Insert", onInsert: edgeData.onInsert }]
      : []);
  const hasInsertActions = insertActions.length > 0;

  return (
    <>
      <path
        d={edgePath}
        fill="none"
        strokeWidth={2}
        style={edgeColor === "green" ? { stroke: "#22c55e" } : edgeColor === "yellow" ? { stroke: "#eab308" } : undefined}
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

      {(edgeData?.label || (isHovered && hasInsertActions)) && (
        <EdgeLabelRenderer>
          <>
            {edgeData?.label && (
              <div
                style={{
                  position: "absolute",
                  transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY - (hasInsertActions ? 16 : 0)}px)`,
                  pointerEvents: "none",
                }}
                className={`rounded-full border bg-background/95 px-2 py-0.5 text-[11px] font-medium shadow-sm ${edgeColor === "green" ? "text-green-500 border-green-500/30" : edgeColor === "yellow" ? "text-yellow-500 border-yellow-500/30" : "text-muted-foreground"}`}
              >
                {edgeData.label}
              </div>
            )}
            {isHovered && hasInsertActions && (
              <div
                style={{
                  position: "absolute",
                  transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY + (edgeData?.label ? 14 : 0)}px)`,
                  pointerEvents: "all",
                }}
                {...buttonProps}
                className="flex items-center gap-1"
              >
                {insertActions.map((action) => (
                  <TooltipProvider key={action.label}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={action.onInsert}
                          className="size-6 rounded-full cursor-copy"
                          aria-label={action.label}
                        >
                          <PlusIcon className="size-3" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="top">{action.label}</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                ))}
              </div>
            )}
          </>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
