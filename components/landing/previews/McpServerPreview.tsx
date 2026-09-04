import mcpCall from "@/lib/landing/generated/mcp-call.json";
import { CodeBlock, type CodeLine } from "@/components/landing/previews/CodeBlock";
import { McpDiagram } from "@/components/landing/previews/McpDiagram";

/** Keys of each returned node summary worth the frame's width. */
const SHOWN_KEYS = ["id", "title", "species", "status"] as const;

/**
 * The diagram on the left; on the right the one real tool call
 * `scripts/generate/generate-landing-samples.js` made against the self-map
 * and the response the server returned, trimmed to the fields that read.
 */
export function McpServerPreview() {
  const request: CodeLine[] = [
    { text: `tools/call ${mcpCall.tool}`, kind: "muted" },
    ...JSON.stringify(mcpCall.arguments, null, 2).split("\n").map((text) => ({ text })),
  ];
  const nodes = (mcpCall.result.nodes as Array<Record<string, unknown>>).map((node) =>
    Object.fromEntries(SHOWN_KEYS.filter((key) => key in node).map((key) => [key, node[key]])),
  );
  const response: CodeLine[] = [
    { text: `${mcpCall.result.total} matching · ${nodes.length} returned`, kind: "muted" },
    ...JSON.stringify(nodes, null, 2).split("\n").map((text) => ({ text })),
  ];
  return (
    <div className="grid h-full gap-4 overflow-hidden p-4 lg:grid-cols-[1.2fr_1fr]">
      <McpDiagram />
      <div className="flex min-h-0 min-w-0 flex-col gap-3">
        <CodeBlock title="request" lines={request} />
        <CodeBlock title="response" lines={response} className="min-h-0 flex-1" />
      </div>
    </div>
  );
}
