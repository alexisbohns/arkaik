import type { MutationOp } from "@arkaik/schema";

import type { Node, Edge, Project, ProjectBundle, JournalEvent } from "./types";

export interface DataProvider {
  getProject(id: string): Promise<ProjectBundle | undefined>;
  listProjects(): Promise<ProjectBundle[]>;
  saveProject(bundle: ProjectBundle): Promise<void>;
  archiveProject(id: string): Promise<void>;

  getNodes(projectId: string): Promise<Node[]>;
  getEdges(projectId: string): Promise<Edge[]>;
  /**
   * The embedded journal events for a project, or `[]` when the bundle carries
   * none (Level 0/1, or history stripped for publish). The browser app reads
   * only the embedded journal; repo `.jsonl` sidecar loading is a CLI/M3
   * concern (docs/spec/journal.md § Storage Shapes).
   */
  getJournal(projectId: string): Promise<JournalEvent[]>;

  createNode(node: Node): Promise<Node>;
  updateNode(id: string, patch: Partial<Omit<Node, "id" | "project_id">>): Promise<Node>;
  deleteNode(id: string): Promise<void>;
  deleteNodes(ids: string[]): Promise<void>;

  createEdge(edge: Edge): Promise<Edge>;
  deleteEdge(id: string): Promise<void>;

  /**
   * Apply several mutations atomically — all of them commit, or none do.
   *
   * The single-op methods above cannot express "create this node AND this edge
   * together", which forces callers into a create-then-create sequence with a
   * hand-rolled rollback when the second half fails. A batch removes that whole
   * class of half-written state. A remote provider sends one request; the local
   * one runs a single IndexedDB transaction.
   */
  applyMutations(projectId: string, ops: MutationOp[]): Promise<{ nodes: Node[]; edges: Edge[] }>;

  exportProject(id: string): Promise<ProjectBundle>;
  importProject(bundle: ProjectBundle): Promise<Project>;
}
