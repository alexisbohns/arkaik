import type { Project } from "./types";

export interface DataProvider {
  getProject(id: string): Promise<Project | undefined>;
  listProjects(): Promise<Project[]>;
  saveProject(project: Project): Promise<void>;
}
