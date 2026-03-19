import type { ProjectBundle } from "./types";

export interface DataProvider {
  getProject(id: string): Promise<ProjectBundle | undefined>;
  listProjects(): Promise<ProjectBundle[]>;
  saveProject(bundle: ProjectBundle): Promise<void>;
}
