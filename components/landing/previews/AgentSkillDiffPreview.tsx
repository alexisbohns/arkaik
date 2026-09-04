import cliValidate from "@/lib/landing/generated/cli-validate.json";
import { CodeBlock, type CodeLine } from "@/components/landing/previews/CodeBlock";
import { FIXTURES } from "@/components/landing/fixtures";
import { CODE_DIFF, journalLine, nodePatch } from "@/components/landing/previews/samples/agent-skill";
import type { PreviewProps } from "@/components/landing/previews/types";

const [NODE_ID] = FIXTURES["agent-skill-diff"].nodeIds!;

/**
 * Left: the code change. Right: the node patch and journal event the skill
 * wrote for it, then the validator's real verdict over the self-map. The node
 * is real and its current status is read from the bundle; the transition is
 * shown as `development → <current>`.
 */
export function AgentSkillDiffPreview({ bundle }: PreviewProps) {
  const node = bundle.nodes.find((n) => n.id === NODE_ID);
  const to = node?.status ?? "live";
  const from = to === "development" ? "idea" : "development";
  const validator: CodeLine[] = [
    { text: `$ ${cliValidate.command}`, kind: "muted" },
    ...cliValidate.output.split("\n").map((text) => ({ text })),
  ];
  return (
    <div className="grid h-full gap-3 overflow-hidden p-4 lg:grid-cols-2">
      <CodeBlock title="The change" lines={CODE_DIFF} />
      <div className="flex min-w-0 flex-col gap-3">
        <CodeBlock title="What the skill wrote" lines={[...nodePatch(NODE_ID, from, to), { text: "" }, ...journalLine(NODE_ID, from, to)]} />
        <CodeBlock title="The gate" lines={validator} />
      </div>
    </div>
  );
}
