import type { DataProvider } from "./data-provider";
import type { Project } from "./types";

const store = new Map<string, Project>();

export const localProvider: DataProvider = {
  async getProject(id: string) {
    return store.get(id);
  },
  async listProjects() {
    return Array.from(store.values());
  },
  async saveProject(project: Project) {
    store.set(project.id, project);
  },
};
