import type { MutationOp } from "@arkaik/schema";

import type { Node, Edge, Project, ProjectBundle, JournalEvent } from "./types";

/**
 * What a project listing needs, without loading every project's whole graph.
 *
 * `listProjects()` used to return full `ProjectBundle`s, which meant the
 * projects page read every node, edge, and journal event of every project just
 * to render titles and counts. That is merely wasteful against IndexedDB and
 * untenable against a server — so the listing now carries counts instead of
 * contents.
 */
export interface ProjectSummary {
  project: Project;
  nodeCount: number;
  edgeCount: number;
  /** True when the project lives in the account rather than in this browser. */
  hosted: boolean;
  /** True for the built-in public seed project (the Arkaik self-map, cycle 4). */
  seed?: boolean;
}

export interface DataProvider {
  getProject(id: string): Promise<ProjectBundle | undefined>;
  listProjects(): Promise<ProjectSummary[]>;
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

  /**
   * Mutators all take `projectId` explicitly, including the ones whose subject
   * id would seem to be enough.
   *
   * The local provider could get away without it — it scans every project in
   * IndexedDB to find the one holding a node id. A remote provider cannot scan,
   * and a routing provider cannot even tell which backend to ask. Passing the
   * project makes the contract honest, removes the scan, and is free at every
   * call site: the hooks are already constructed as `useNodes(projectId)`.
   */
  createNode(node: Node): Promise<Node>;
  updateNode(projectId: string, id: string, patch: Partial<Omit<Node, "id" | "project_id">>): Promise<Node>;
  deleteNode(projectId: string, id: string): Promise<void>;
  deleteNodes(projectId: string, ids: string[]): Promise<void>;

  createEdge(edge: Edge): Promise<Edge>;
  deleteEdge(projectId: string, id: string): Promise<void>;

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
