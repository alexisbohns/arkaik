"use client";

import { useMemo, useState } from "react";
import { PlusIcon } from "lucide-react";
import { toast } from "sonner";
import type { Node as DataNode } from "@/lib/data/types";
import { useNodes } from "@/lib/hooks/useNodes";
import { useEdges } from "@/lib/hooks/useEdges";
import { useProjectId } from "@/lib/hooks/useProjectId";
import { useProjectPanels } from "@/lib/hooks/useProjectPanels";
import { useProject } from "@/lib/hooks/useProject";
import { useJournal } from "@/lib/hooks/useJournal";
import { useEffectiveProduct } from "@/lib/hooks/useProductScope";
import { DecisionFilterBar, type DecisionStatusFilter } from "@/components/decisions/DecisionFilterBar";
import { DecisionLog } from "@/components/decisions/DecisionLog";
import { PageError } from "@/components/layout/PageError";
import { PageLoading } from "@/components/layout/PageLoading";
import { PageShell } from "@/components/layout/PageShell";
import { PageSurface } from "@/components/layout/PageSurface";
import { generateNodeId } from "@/lib/utils/id";
import { decisionStatusCounts, withDecisionStatus } from "@/lib/utils/decision";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { lifecycleStatusForDecision } from "@arkaik/schema";

export default function ProjectDecisionsPage() {
  const id = useProjectId();

  const { openNode } = useProjectPanels();
  const { nodes: dataNodes, loading: nodesLoading, error: nodesError, reload: reloadNodes, updateNode, addNode } = useNodes(id);
  const { edges: dataEdges, loading: edgesLoading, error: edgesError, reload: reloadEdges } = useEdges(id);
  const { project: projectBundle, error: projectError, reload: reloadProject } = useProject(id);
  const { journal, error: journalError, reload: reloadJournal } = useJournal(id);
  const scope = useEffectiveProduct(id, projectBundle);

  const [newOpen, setNewOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  // Owned here, not in `DecisionLog`: the toolbar and the log are siblings, so
  // the filter they share belongs to the page that mounts both.
  const [statusFilter, setStatusFilter] = useState<DecisionStatusFilter>("all");

  const decisions = useMemo(
    () => dataNodes.filter((node) => node.species === "decision"),
    [dataNodes],
  );
  const statusCounts = useMemo(() => decisionStatusCounts(decisions), [decisions]);
  const nodesById = useMemo(() => new Map(dataNodes.map((n) => [n.id, n])), [dataNodes]);

  function handleSelectNode(node: DataNode) {
    openNode({ nodeId: node.id });
  }

  async function handleNodeUpdate(nodeId: string, patch: Partial<Omit<DataNode, "id" | "project_id">>) {
    await updateNode(nodeId, patch);
  }

  // A new decision is born proposed; the lifecycle status carries the synced
  // value from day one (proposed → discovery, spec §2). Decisions carry no
  // platforms — availability is not a tracked dimension for them.
  async function handleCreateDecision() {
    const title = newTitle.trim();
    if (title === "") return;
    setNewOpen(false);
    setNewTitle("");
    try {
      const created = await addNode({
        id: generateNodeId("decision", title, nodesById.keys()),
        project_id: id,
        species: "decision",
        title,
        status: lifecycleStatusForDecision("proposed"),
        platforms: [],
        metadata: withDecisionStatus(undefined, "proposed"),
      });
      handleSelectNode(created);
    } catch (err) {
      toast.error("Couldn't create the decision.");
      console.error(err);
    }
  }

  if (nodesLoading || edgesLoading) {
    return <PageLoading label="decisions" />;
  }

  // Before `DecisionLog`, never after (#362): fed an empty list it draws its own
  // "no decisions" body under a header reading "0 total", which is a decision
  // log that looks erased rather than unread.
  const loadError = nodesError ?? edgesError ?? projectError ?? journalError;
  if (loadError) {
    return (
      <PageError
        label="decisions"
        message={loadError}
        onRetry={() => {
          void reloadNodes();
          void reloadEdges();
          void reloadProject();
          void reloadJournal();
        }}
      />
    );
  }

  return (
    <>
      <PageShell
        title="Decisions"
        meta={`${decisions.length} total`}
        action={{ label: "New decision", icon: PlusIcon, onClick: () => setNewOpen(true) }}
        allNodes={dataNodes}
        allEdges={dataEdges}
        scope={scope}
        journal={journal}
        onUpdate={handleNodeUpdate}
      >
        <PageSurface
          contentClassName="flex flex-col gap-4"
          toolbar={
            <DecisionFilterBar
              status={statusFilter}
              onStatusChange={setStatusFilter}
              total={decisions.length}
              counts={statusCounts}
            />
          }
        >
          <DecisionLog
            decisions={decisions}
            allEdges={dataEdges}
            journal={journal}
            onSelect={handleSelectNode}
            statusFilter={statusFilter}
          />
        </PageSurface>
      </PageShell>
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New decision</DialogTitle>
            <DialogDescription className="sr-only">
              Name the decision — the What. Context, consequences, and status are set in its panel.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void handleCreateDecision();
            }}
          >
            <Input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Short decision statement — the What"
              aria-label="Decision title"
              autoFocus
            />
            <Button type="submit" disabled={newTitle.trim() === ""}>
              Create
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
