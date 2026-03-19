import type { DataProvider } from "./data-provider";
import type { ProjectBundle } from "./types";

const store = new Map<string, ProjectBundle>();

export const localProvider: DataProvider = {
  async getProject(id: string) {
    return store.get(id);
  },
  async listProjects() {
    return Array.from(store.values());
  },
  async saveProject(bundle: ProjectBundle) {
    store.set(bundle.project.id, bundle);
  },
};
