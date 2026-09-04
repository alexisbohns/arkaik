import type { CodeLine } from "@/components/landing/previews/CodeBlock";

/**
 * D1's left pane: the code change an agent made. Illustrative — the file and
 * hunk are a plausible Arkaik change, not a real commit; the node patch and
 * journal event on the right are what the skill writes for it, and the
 * validator output is real (`lib/landing/generated/cli-validate.json`).
 */
export const CODE_DIFF: CodeLine[] = [
  { text: "components/maps/JourneyMap.tsx", kind: "muted" },
  { text: "@@ -41,6 +41,9 @@ export function JourneyMap({ projectId }: JourneyMapProps) {", kind: "muted" },
  { text: "   const params = useJourneyGraphParams(projectId);" },
  { text: "+  const handleNodeClick = useCallback(" },
  { text: "+    (id: string) => openNode(id), [openNode]," },
  { text: "+  );" },
  { text: "   return <JourneyCanvas {...params} onNodeClick={handleNodeClick} />;" },
];

/** The snapshot patch the skill makes for that change: one field, one node. */
export function nodePatch(nodeId: string, from: string, to: string): CodeLine[] {
  return [
    { text: "docs/arkaik/bundle.json", kind: "muted" },
    { text: `   "id": "${nodeId}",` },
    { text: `-  "status": "${from}",`, kind: "del" },
    { text: `+  "status": "${to}",`, kind: "add" },
  ];
}

/** The journal line appended in the same commit. */
export function journalLine(nodeId: string, from: string, to: string): CodeLine[] {
  return [
    { text: "docs/arkaik/journal.jsonl", kind: "muted" },
    {
      kind: "add",
      text: `+{"id":"01K4…","ts":"2026-09-04T10:12:00Z","actor":"claude-code","type":"node.status_changed","node_id":"${nodeId}","from":"${from}","to":"${to}"}`,
    },
  ];
}
