import type { DataProvider } from "./data-provider";
import type { Node, Edge, ProjectBundle } from "./types";

const STORAGE_KEY = "arkaik:store";

function loadStore(): Map<string, ProjectBundle> {
  if (typeof window === "undefined") return new Map();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Map();
    const obj = JSON.parse(raw) as Record<string, ProjectBundle>;
    return new Map(Object.entries(obj));
  } catch (err) {
    console.error("[LocalProvider] Failed to load store from localStorage:", err);
    return new Map();
  }
}

function persistStore(store: Map<string, ProjectBundle>) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(store)));
}

const store = loadStore();
/** Maps node id → project id for O(1) lookup. */
const nodeIndex = new Map<string, string>();
/** Maps edge id → project id for O(1) lookup. */
const edgeIndex = new Map<string, string>();

function isArchived(bundle: ProjectBundle): boolean {
  return Boolean(bundle.project.archived_at);
}

// Rebuild indexes from persisted data
for (const bundle of store.values()) {
  bundle.nodes.forEach((n) => nodeIndex.set(n.id, bundle.project.id));
  bundle.edges.forEach((e) => edgeIndex.set(e.id, bundle.project.id));
}

export const localProvider: DataProvider = {
  async getProject(id: string) {
    return store.get(id);
  },
  async listProjects() {
    return Array.from(store.values()).filter((bundle) => !isArchived(bundle));
  },
  async saveProject(bundle: ProjectBundle) {
    store.set(bundle.project.id, bundle);
    bundle.nodes.forEach((n) => nodeIndex.set(n.id, bundle.project.id));
    bundle.edges.forEach((e) => edgeIndex.set(e.id, bundle.project.id));
    persistStore(store);
  },
  async archiveProject(id: string) {
    const bundle = store.get(id);
    if (!bundle) throw new Error(`Project ${id} not found`);
    const now = new Date().toISOString();
    bundle.project = {
      ...bundle.project,
      archived_at: now,
      updated_at: now,
    };
    persistStore(store);
  },

  async getNodes(projectId: string) {
    return store.get(projectId)?.nodes ?? [];
  },
  async getEdges(projectId: string) {
    return store.get(projectId)?.edges ?? [];
  },

  async createNode(node: Node) {
    const bundle = store.get(node.project_id);
    if (!bundle) throw new Error(`Project ${node.project_id} not found`);
    bundle.nodes.push(node);
    nodeIndex.set(node.id, node.project_id);
    persistStore(store);
    return node;
  },
  async updateNode(id: string, patch: Partial<Omit<Node, "id" | "project_id">>) {
    const projectId = nodeIndex.get(id);
    if (!projectId) throw new Error(`Node ${id} not found`);
    const bundle = store.get(projectId)!;
    const idx = bundle.nodes.findIndex((n) => n.id === id);
    bundle.nodes[idx] = { ...bundle.nodes[idx], ...patch };
    persistStore(store);
    return bundle.nodes[idx];
  },
  async deleteNode(id: string) {
    const projectId = nodeIndex.get(id);
    if (!projectId) throw new Error(`Node ${id} not found`);
    const bundle = store.get(projectId)!;
    bundle.nodes = bundle.nodes.filter((n) => n.id !== id);
    bundle.edges = bundle.edges.filter((e) => {
      if (e.source_id === id || e.target_id === id) {
        edgeIndex.delete(e.id);
        return false;
      }
      return true;
    });
    nodeIndex.delete(id);
    persistStore(store);
  },

  async createEdge(edge: Edge) {
    const bundle = store.get(edge.project_id);
    if (!bundle) throw new Error(`Project ${edge.project_id} not found`);
    bundle.edges.push(edge);
    edgeIndex.set(edge.id, edge.project_id);
    persistStore(store);
    return edge;
  },
  async deleteEdge(id: string) {
    const projectId = edgeIndex.get(id);
    if (!projectId) throw new Error(`Edge ${id} not found`);
    const bundle = store.get(projectId)!;
    bundle.edges = bundle.edges.filter((e) => e.id !== id);
    edgeIndex.delete(id);
    persistStore(store);
  },

  async exportProject(id: string) {
    const bundle = store.get(id);
    if (!bundle) throw new Error(`Project ${id} not found`);
    return bundle;
  },
  async importProject(bundle: ProjectBundle) {
    store.set(bundle.project.id, bundle);
    bundle.nodes.forEach((n) => nodeIndex.set(n.id, bundle.project.id));
    bundle.edges.forEach((e) => edgeIndex.set(e.id, bundle.project.id));
    persistStore(store);
    return bundle.project;
  },
};
