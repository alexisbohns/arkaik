import type { Species } from "@/lib/config/species";
import type { Status } from "@/lib/config/statuses";
import type { EdgeType } from "@/lib/config/edge-types";
import type { Platform } from "@/lib/config/platforms";

export interface ArkaikNode {
  id: string;
  title: string;
  species: Species;
  status: Status;
  platforms: Platform[];
  description?: string;
}

export interface ArkaikEdge {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
}

export interface Project {
  id: string;
  title: string;
  description?: string;
  nodes: ArkaikNode[];
  edges: ArkaikEdge[];
}
