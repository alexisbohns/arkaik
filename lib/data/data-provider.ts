import type { Node, Edge, Project, ProjectBundle } from "./types";

export interface DataProvider {
  getProject(id: string): Promise<ProjectBundle | undefined>;
  listProjects(): Promise<ProjectBundle[]>;
  saveProject(bundle: ProjectBundle): Promise<void>;

  getNodes(projectId: string): Promise<Node[]>;
  getEdges(projectId: string): Promise<Edge[]>;

  createNode(node: Node): Promise<Node>;
  updateNode(id: string, patch: Partial<Omit<Node, "id" | "project_id">>): Promise<Node>;
  deleteNode(id: string): Promise<void>;

  createEdge(edge: Edge): Promise<Edge>;
  deleteEdge(id: string): Promise<void>;

  exportProject(id: string): Promise<ProjectBundle>;
  importProject(bundle: ProjectBundle): Promise<Project>;
}
