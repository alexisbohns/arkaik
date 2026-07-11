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

  exportProject(id: string): Promise<ProjectBundle>;
  importProject(bundle: ProjectBundle): Promise<Project>;
}
