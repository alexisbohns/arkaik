"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { PlusIcon } from "lucide-react";
import { computeMapSubgraph, listMaps, MAP_KINDS, type MapDefinition } from "@arkaik/schema";
import { MapCard } from "@/components/maps/MapCard";
import { MapEditorDialog } from "@/components/maps/MapEditorDialog";
import { DeleteConfirmDialog } from "@/components/graph/DeleteConfirmDialog";
import { PageShell } from "@/components/layout/PageShell";
import { useEdges } from "@/lib/hooks/useEdges";
import { useNodes } from "@/lib/hooks/useNodes";
import { useProject } from "@/lib/hooks/useProject";

/**
 * The maps index: every reading the project offers — the built-ins plus the
 * custom maps stored at `project.metadata.maps` (docs/spec/maps.md).
 */
export default function ProjectMapsPage() {
  const params = useParams();
  const id = Array.isArray(params.id) ? params.id[0] : params.id ?? "";

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorTarget, setEditorTarget] = useState<MapDefinition | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<MapDefinition | null>(null);

  const { nodes: dataNodes, loading: nodesLoading } = useNodes(id);
  const { edges: dataEdges, loading: edgesLoading } = useEdges(id);
  const { project: projectBundle, loading: projectLoading, updateProject } = useProject(id);

  const maps = useMemo(
    () => (projectBundle ? listMaps(projectBundle.project) : []),
    [projectBundle],
  );

  const storedMaps = useMemo<MapDefinition[]>(() => {
    const stored = projectBundle?.project.metadata?.maps;
    return Array.isArray(stored) ? stored : [];
  }, [projectBundle]);

  const counts = useMemo(
    () =>
      new Map(
        maps.map((definition) => {
          const subgraph = computeMapSubgraph(definition, dataNodes, dataEdges);
          return [definition.id, { nodes: subgraph.nodes.length, edges: subgraph.edges.length }];
        }),
      ),
    [dataEdges, dataNodes, maps],
  );

  async function saveStoredMaps(nextStored: MapDefinition[]) {
    if (!projectBundle) return;
    await updateProject({
      metadata: {
        ...(projectBundle.project.metadata ?? {}),
        maps: nextStored,
      },
    });
  }

  async function handleSaveMap(definition: MapDefinition) {
    const existingIndex = storedMaps.findIndex((stored) => stored.id === definition.id);
    const nextStored = [...storedMaps];
    if (existingIndex >= 0) nextStored[existingIndex] = definition;
    else nextStored.push(definition);
    await saveStoredMaps(nextStored);
  }

  async function handleDeleteMap() {
    if (!deleteTarget) return;
    await saveStoredMaps(storedMaps.filter((stored) => stored.id !== deleteTarget.id));
    setDeleteTarget(null);
  }

  if (nodesLoading || edgesLoading || projectLoading) {
    return (
      <div className="h-full w-full flex items-center justify-center">
        <span className="text-muted-foreground text-sm">Loading maps...</span>
      </div>
    );
  }

  return (
    <>
      <PageShell
        title="Maps"
        action={{
          label: "New map",
          icon: PlusIcon,
          onClick: () => {
            setEditorTarget(undefined);
            setEditorOpen(true);
          },
        }}
      >
        <div className="h-full overflow-auto p-4 md:p-6">
          <div className="mx-auto grid w-full max-w-5xl gap-4 sm:grid-cols-2">
            {maps.map((definition) => {
              const count = counts.get(definition.id) ?? { nodes: 0, edges: 0 };
              const builtIn = definition.id === "journey" || definition.id === "system";
              const renderable = (MAP_KINDS as readonly string[]).includes(definition.kind);

              return (
                <MapCard
                  key={definition.id}
                  definition={definition}
                  href={`/project/${id}/maps/${definition.id}`}
                  nodeCount={count.nodes}
                  edgeCount={count.edges}
                  builtIn={builtIn}
                  renderable={renderable}
                  onEdit={
                    builtIn
                      ? undefined
                      : () => {
                          setEditorTarget(definition);
                          setEditorOpen(true);
                        }
                  }
                  onDelete={builtIn ? undefined : () => setDeleteTarget(definition)}
                />
              );
            })}
          </div>
        </div>
      </PageShell>

      <MapEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        initialDefinition={editorTarget}
        existingMapIds={maps.map((definition) => definition.id)}
        allNodes={dataNodes}
        onSave={handleSaveMap}
      />
      <DeleteConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={`Delete map "${deleteTarget?.title ?? ""}"?`}
        description="This removes the saved map definition. The graph itself is untouched."
        confirmLabel="Delete"
        onConfirm={() => void handleDeleteMap()}
      />
    </>
  );
}
